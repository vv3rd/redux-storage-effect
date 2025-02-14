import { Type, TypeOf, number, string, type } from "io-ts";
import { describe, expect, it, mock } from "bun:test";
import { MigrationError, buildMigration } from "../src/Migration";

describe("buildMigrations()", () => {
  it("must automatically increment version number", () => {
    expect(setupV1().version).toBe(1);
    expect(setupV2().version).toBe(2);
    expect(setupV3().version).toBe(3);
  });

  const dataV1: v1 = { foo: "123" };
  const dataV2: v2 = { bar: 123 };

  it("must not modify data of same version", () => {
    {
      const migrated = setupV1().migrate(dataV1, 1);
      expect(migrated).toEqual(dataV1);
    }
    {
      const migrated = setupV2().migrate(dataV2, 2);
      expect(migrated).toEqual(dataV2);
    }
  });

  it("must migrate from any version to current", () => {
    {
      const v3 = setupV3();
      const migrated = v3.migrate(dataV1, 1);
      expect(migrated).toEqual({ baz: "123" });
    }
  });

  it("wraps error thrown during migration in MigrationError", () => {
    const v3 = setupV3();
    const spy = mock(() => v3.migrate({ foo: 321 }, 1));
    expect(spy).toThrowError(MigrationError);
  });
});

const v1 = type({ foo: string });
type v1 = TypeOf<typeof v1>;

const v2 = type({ bar: number });
type v2 = TypeOf<typeof v2>;

const v3 = type({ baz: string });
type v3 = TypeOf<typeof v3>;

const mustBe =
  <T>(codec: Type<T>) =>
  (thing: unknown) => {
    const decoded = codec.decode(thing);
    if ("left" in decoded) throw new Error("[test] validation fail");
    return decoded.right;
  };

function setupV1() {
  return buildMigration<v1>(_ => _.currentVersion(mustBe(v1)));
}

function setupV2() {
  return buildMigration<v2>(_ =>
    _.currentVersion(mustBe(v2)).olderVersion(mustBe(v1), v0 => ({
      bar: Number(v0.foo),
    }))
  );
}

function setupV3() {
  return buildMigration<v3>(_ =>
    _.currentVersion(mustBe(v3))
      .olderVersion(mustBe(v2), v1 => ({ baz: String(v1.bar) }))
      .olderVersion(mustBe(v1), v0 => ({ bar: Number(v0.foo) }))
  );
}
