import { Real } from "./Config";

export type VersioningConfig<TState extends Real> = Pick<
    BuildResult<TState>,
    "migrate" | "version"
>;

export interface VersioningConfigBuilder<TLatest extends Real> {
    (builder: CurrentVersionBuildStep<TLatest>): VersioningConfig<TLatest>;
}

export const buildMigration = <TLatest extends Real>(
    migrationsDefinition: VersioningConfigBuilder<TLatest>,
) => {
    const migrations = new Migrations<TLatest>();

    const buildStart = new CurrentVersionBuildStep(migrations);

    return migrationsDefinition(buildStart);
};

export const ResetSentinel = Symbol();

type MigrationFn = (persisted: Real) => Real | typeof ResetSentinel;
class Migrations<TLatest> {
    private readonly migrations = new Array<MigrationFn>();

    add(migrationFn: MigrationFn) {
        this.migrations.unshift(migrationFn);
    }

    run(state: Real, version: number): TLatest | typeof ResetSentinel {
        try {
            if (version > this.currentVersion) {
                return ResetSentinel;
            }
            for (; version <= this.currentVersion; version++) {
                state = this.migrations[version - 1](state);
            }
            return state as TLatest;
        } catch (error) {
            throw new MigrationError(error, {
                persistedData: state,
                fromVersion: version,
                toVersion: this.currentVersion,
            });
        }
    }

    get currentVersion() {
        return this.migrations.length;
    }
}

abstract class BuildResult<TLatest extends Real> {
    constructor(protected readonly migrations: Migrations<TLatest>) {}

    get migrate() {
        return this.migrations.run.bind(this.migrations);
    }

    get version() {
        return this.migrations.currentVersion;
    }
}

class OlderVersionBuildStep<
    TLatestShape extends Real,
    TNewerShape extends Real,
> extends BuildResult<TLatestShape> {
    olderVersion<TOwnShape extends Real>(
        this: OlderVersionBuildStep<TLatestShape, TNewerShape>,
        validate: (state: unknown) => TOwnShape,
        migrate: (self: TOwnShape) => TNewerShape,
    ) {
        this.migrations.add((state) => migrate(validate(state)));
        return new OlderVersionBuildStep<TLatestShape, TOwnShape>(
            this.migrations,
        );
    }
}

class CurrentVersionBuildStep<
    TLatest extends Real,
> extends BuildResult<TLatest> {
    currentVersion(
        this: CurrentVersionBuildStep<TLatest>,
        validate: (state: unknown) => TLatest,
    ) {
        this.migrations.add(validate);
        return new OlderVersionBuildStep<TLatest, TLatest>(this.migrations);
    }
}

export class MigrationError extends Error {
    readonly name = "MigrationError";
    readonly persistedShape: ShapeDescription | TypeDescription;

    constructor(
        cause: unknown,
        meta: {
            fromVersion: number;
            toVersion: number;
            persistedData: unknown;
        },
    ) {
        // cannot have the data itself in error - it might contain sensitive information we should not send to sentry
        const shape = describeShape(meta.persistedData);
        const serializedShape = JSON.stringify(shape);
        const message = `Migration from ${meta.fromVersion} to ${meta.toVersion} failed. Persisted ${serializedShape.slice(0, 60)}`;
        super(message, { cause });
        this.persistedShape = shape;
    }
}

type JsType =
    | "string"
    | "number"
    | "bigint"
    | "boolean"
    | "symbol"
    | "undefined"
    | "object"
    | "function";
type TypeDescription = JsType | `Array<${string}>`;
type ShapeDescription = { [key: string]: TypeDescription | ShapeDescription };

const describeShape = (thing: unknown): TypeDescription | ShapeDescription => {
    if (!thing || typeof thing !== "object") {
        return typeof thing;
    }
    if (Array.isArray(thing)) {
        return `Array<${describeShape(thing[0])}>`;
    }
    return Object.fromEntries(
        Object.entries(thing).map(([key, value]) => [
            key,
            describeShape(value),
        ]),
    );
};
