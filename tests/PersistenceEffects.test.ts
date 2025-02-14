import {
  configureStore,
  createAction,
  createListenerMiddleware,
  createReducer,
} from "@reduxjs/toolkit";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { Config, SyncSelector } from "../src";
import { Real } from "../src/Config";
import { OwnerKey } from "../src/DiskSpace";
import { createPersistenceEffects } from "../src/PersistenceEffects";

let _memory: Record<string, string> = {};
const mockStorage: Storage = {
  clear() {
    _memory = {};
  },
  getItem(key) {
    return _memory[key];
  },
  setItem(key, value) {
    _memory[key] = value;
  },
  key(idx) {
    throw Object.keys(_memory)[idx];
  },
  removeItem(key) {
    delete _memory[key];
  },
  get length() {
    return Object.keys(_memory).length;
  },
};
afterEach(() => {
  mockStorage.clear();
});

function dumpStorage() {
  return { ..._memory };
}

describe("Persistence effects spec", () => {
  it("persists values between store instances", () => {
    const oldState = (() => {
      const { store, setState } = setup({ count: 0, hello: "world" });
      const initialState = store.getState();
      // multiple updates to ensure that latest state is persisted
      store.dispatch(setState({ ...initialState.test, count: 1 }));
      store.dispatch(setState({ ...initialState.test, count: 2 }));
      store.dispatch(setState({ ...initialState.test, count: 3 }));
      const currentState = store.getState();
      // testing the test itself to prevent flakiness
      expect(currentState).not.toEqual(initialState);
      return currentState;
    })();
    {
      const { store, effects } = setup({ count: -1, hello: "another thing" });
      const initialState = store.getState();
      store.dispatch(effects.hydrate.asThunk);
      const hydratedState = store.getState();

      expect(hydratedState).not.toEqual(initialState);
      expect(hydratedState).toEqual(oldState);
    }
  });

  it("migrates from previous version", () => {
    const persistedState = (() => {
      const runtimeValue = `new-state-${randomString()}`;
      const { store: storeV0, setState } = setup(
        { hello: "init" },
        { version: 0 }
      );
      storeV0.dispatch(setState({ hello: runtimeValue }));
      const currentState = storeV0.getState();
      return currentState;
    })();

    const migrate = mock((stateToMigrate: any, version: number) => {
      expect(stateToMigrate).toEqual(persistedState.test);
      if (version === 0) {
        return { goodbye: stateToMigrate.hello };
      } else {
        return stateToMigrate;
      }
    });
    const { store: storeV1, effects } = setup(
      { goodbye: "init" },
      { version: 1, migrate }
    );
    expect(migrate).not.toBeCalled();
    effects.hydrate(storeV1);
    expect(migrate).toBeCalledTimes(1);

    const migratedState = storeV1.getState();
    expect(migratedState.test).toEqual({ goodbye: persistedState.test.hello });
  });

  it("should skip migration if versions are same", () => {
    const version = 99;

    const oldState = (() => {
      const { store, setState } = setup({ hello: "init" }, { version });
      store.dispatch(setState({ hello: "world" }));
      return store.getState();
    })();

    const badMigration = { hello: "not what was stored" };
    const { store, effects } = setup(
      { hello: "" },
      { version, migrate: () => badMigration }
    );
    store.dispatch(effects.hydrate.asThunk);

    expect(store.getState()).toEqual(oldState);
    expect(store.getState()).not.toEqual(badMigration);
  });

  it("can persist non-serializable data", () => {
    const myJSON = {
      stringify: value =>
        JSON.stringify(value, (_key, value) =>
          value instanceof Map ? { v: [...value], t: "Map" } : value
        ),
      parse: value =>
        JSON.parse(value, (_key, value) =>
          value.v && value.t === "Map" ? new Map(value.v) : value
        ),
    } as typeof JSON;

    const persistedState = (() => {
      const state = { myMap: new Map([["a", "b"]]) };

      expect(myJSON.parse(myJSON.stringify(state))).toEqual(state); // proof that replacer and reviver are working correctly

      const { store, setState } = setup({}, { json: myJSON });
      store.dispatch(setState({ ...state })); // set non-serializable data
      return store.getState();
    })();

    const { store, effects } = setup({}, { json: myJSON });
    store.dispatch(effects.hydrate.asThunk);
    expect(store.getState()).toEqual(persistedState);
  });

  it("should store data from multiple owners and allow owner change without data loss", () => {
    let owner: OwnerKey; // normally instead of using mutable variable we would select owner from store, this is just for a test

    const { store, setState, effects } = setup("init", {
      select: store => ({ owner: owner, state: store.test }),
    });

    owner = "A";
    store.dispatch(setState("belongs to A"));

    owner = "B";
    store.dispatch(setState("belongs to B"));

    owner = "A";
    store.dispatch(effects.hydrate.asThunk);
    expect(store.getState().test).toEqual("belongs to A");

    owner = "B";
    store.dispatch(effects.hydrate.asThunk);
    expect(store.getState().test).toEqual("belongs to B");
  });

  it("stores data only if `skipSync` is not true", () => {
    const initialState = { isValid: true, message: "" };
    type state = typeof initialState;
    const select: SyncSelector<state, { test: state }> = ({ test: state }) => ({
      owner: "static",
      state: state,
      skipSync: !state.isValid,
    });
    {
      const { store, setState } = setup(initialState, { select: select });
      store.dispatch(
        setState({ isValid: true, message: "this must be stored" })
      );
      store.dispatch(
        setState({ isValid: false, message: "do not store this" })
      );
    }
    {
      const { store, effects } = setup(initialState, { select: select });
      effects.hydrate(store);
      expect(store.getState().test.message).toEqual("this must be stored");
      expect(store.getState().test.message).not.toEqual("do not store this");
    }
  });

  it("clears data if it is nullish and `skipSync` is not true", () => {
    const MAGIC_STRING = "TIME TO BE DELETED";
    const { store, setState } = setup("init", {
      select: ({ test: state }) => ({
        owner: "static",
        state: state === MAGIC_STRING ? null : state,
      }),
    });
    store.dispatch(setState("new state 1"));
    store.dispatch(setState("new state 2"));
    expect(dumpStorage()).toMatchInlineSnapshot(`
          {
            "aRzf3d7co0u-DISK:test:static": "0|"new state 2"",
          }
        `);
    store.dispatch(setState(MAGIC_STRING));
    expect(dumpStorage()).toMatchInlineSnapshot(`{}`);
  });

  it("removes data from all owners when purge effect is triggered", () => {
    let owner: OwnerKey; // normally instead of using mutable variable we would select owner from store, this is just for a test

    const { store, setState, effects } = setup("init", {
      select: store => ({ owner: owner, state: store.test }),
    });

    owner = "A";
    store.dispatch(setState("belongs to A"));

    owner = "B";
    store.dispatch(setState("belongs to B"));
    expect(dumpStorage()).toMatchInlineSnapshot(`
          {
            "aRzf3d7co0u-DISK:test:A": "0|"belongs to A"",
            "aRzf3d7co0u-DISK:test:B": "0|"belongs to B"",
          }
        `);
    store.dispatch(effects.purge.asThunk);
    expect(dumpStorage()).toMatchInlineSnapshot(`{}`);
  });
});

function setup<T extends Real>(
  initialState: T,
  {
    select: select = ({ test }) => ({ owner: "static", state: test }),
    ...config
    //
  } = {} as Partial<
    Pick<Config<T, { test: T }>, "select" | "migrate" | "version" | "json">
  >
) {
  const setState = createAction("setState", (state: T) => ({ payload: state }));

  const hydratableReducer = createReducer(initialState, ({ addCase }) => {
    addCase(setState, (_, action) => action.payload);
  });

  const effects = createPersistenceEffects("test", mockStorage, {
    ...config,
    actualize: {
      migrate: config.migrate ?? (state => state as T),
      version: config.version ?? 0,
    },
    select,
    hydrate: setState,
  });

  const listeners = createListenerMiddleware<{ test: T }>();
  listeners.startListening({
    predicate: () => true,
    effect: effects.update.asListener,
  });

  const store = configureStore({
    reducer: { test: hydratableReducer },
    middleware: getDM =>
      getDM({ serializableCheck: false }).concat(listeners.middleware),
  });

  return { store, effects, setState };
}

function randomString() {
  return Math.random().toString(36).substring(2);
}
