import {Action, Dispatch} from 'redux';
import {Config, ConfigCreationOptions, Real} from './Config';
import {DiskSpace, OwnerKey, createDiskSpace} from './DiskSpace';
import {ResetSentinel, buildMigration} from './Migration';
import {StorageKey, WebStorage, local, session} from './WebStorage';

export function createPersistenceEffects<TState extends Real, TParent extends Real>(
    ...params: Parameters<typeof resolveConfig<TState, TParent>>
) {
    const config = resolveConfig(...params);
    return createPersistenceEffectsImpl(config);
}

export function createPersistenceEffectsImpl<TState extends Real, TParent extends Real>(
    config: Config<TState, TParent>
) {
    const disk = createDiskSpace(config);
    return {
        hydrate: createHydrateEffect(config, disk),
        update: createUpdateEffect(config, disk),
        purge: createPurgeEffect(disk),
    };
}

export function resolveConfig<TState extends Real, TParent extends Real>(
    key: StorageKey,
    storage: WebStorage | 'local' | 'session',
    config: ConfigCreationOptions<TState, TParent>
): Config<TState, TParent> {
    const {actualize, hydrate, select, compare, json} = config;

    const {version, migrate} = typeof actualize === 'object' ? actualize : buildMigration(actualize);

    return {
        key,
        storage: typeof storage !== 'object' ? {local, session}[storage] : storage,

        version,
        migrate,

        hydrate,
        select,

        compare: compare ?? Object.is,
        json: json ?? JSON,
    };
}

interface MinimalRequiredStoreAPI<TParent> {
    getState: () => TParent;
    dispatch: Dispatch;
}
function createEffect<TParent>(effectFn: (api: MinimalRequiredStoreAPI<TParent>) => void) {
    const effect = effectFn.bind(null); // cloning function

    const adapters = {
        asListener: (_action: Action, api: MinimalRequiredStoreAPI<TParent>) => effectFn(api),
        asThunk: (dispatch: Dispatch, getState: () => TParent) => effectFn({dispatch, getState}),
    } as const;

    return Object.assign(effect, adapters);
}

// Hydrate

function createHydrateEffect<TState extends Real, TParent extends Real>(
    config: Config<TState, TParent>,
    disk: DiskSpace<TState>
) {
    const theHydrateEffect = createEffect<TParent>(api => {
        const {owner} = config.select(api.getState());
        if (owner == null) return;

        const persistedData = disk.get(owner);
        if (!persistedData) return;

        const validData = ensureVersionRelevance(persistedData, owner);
        if (!validData) return;

        const actionOrTask = config.hydrate(validData);
        if (typeof actionOrTask === 'function') {
            actionOrTask(api.dispatch);
        } else {
            api.dispatch(actionOrTask);
        }
    });

    const ensureVersionRelevance = (persisted: {version: number; data: Real}, owner: OwnerKey) => {
        if (persisted.version === config.version) {
            return persisted.data as TState;
        }

        const migratedData = config.migrate(persisted.data, persisted.version);

        if (migratedData === ResetSentinel) {
            disk.clear(owner);
            return undefined;
        } else {
            disk.set(owner, migratedData);
            return migratedData;
        }
    };

    return theHydrateEffect;
}

// Update

function createUpdateEffect<TState extends Real, TParent extends Real>(
    config: Config<TState, TParent>,
    disk: DiskSpace<TState>
) {
    const theUpdateEffect = createEffect<TParent>(api => {
        const update = config.select(api.getState());
        if (update.skipSync) {
            return;
        }
        const {owner, state} = update;
        if (!state) {
            disk.clear(owner);
            return;
        }
        if (hasChanged(state)) {
            disk.set(owner, state);
        }
    });

    const hasChanged = createChangeDetector<TState>(config.compare);

    return theUpdateEffect;
}

const createChangeDetector = <T extends Real>(isEqual: (a: T, b: T) => boolean) => {
    let current = createWeakRef<T | undefined>(undefined);
    const isNew = (value: T): boolean => {
        const previous = current.deref();
        if (!previous || !isEqual(previous, value)) {
            current = createWeakRef(value);
            return true;
        }
        return false;
    };
    return isNew;
};

const createWeakRef = <T>(data: T): {readonly deref: () => T | undefined} => {
    if (data && typeof data === 'object') {
        return new WeakRef(data);
    } else {
        return {deref: () => data};
    }
};

// Purge

function createPurgeEffect<TState extends Real, TParent>(disk: DiskSpace<TState>) {
    const thePurgeEffect = createEffect<TParent>(() => {
        disk.clearAll();
    });

    return thePurgeEffect;
}
