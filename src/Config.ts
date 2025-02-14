import { PayloadAction } from "@reduxjs/toolkit";
import { Dispatch } from "redux";
import { OwnerKey } from "./DiskSpace";
import { VersioningConfig, VersioningConfigBuilder } from "./Migration";
import { StorageKey, WebStorage } from "./WebStorage";

export type Real = NonNullable<unknown>;

interface SyncConfig<TState extends Real, TParent> {
  /**
   * Action or Thunk-like function that should dispatch actions that would hydrate the state.
   */
  readonly hydrate: Hydrate<TState>;

  /**
   * Selector used to define how current state should be synchronized with storage.
   *
   * `owner` prop is a dynamic key, it can be used to persist multiple variants of the same state
   * based on any other part of application state.
   *
   * `state` is the data that should be stored, when set to `null` or `undefined`, the state will be cleared.
   *
   * `skipSync` is a flag that indicates whether the state should be persisted or not. If it's `true`,
   * the state will not be persisted.
   */
  readonly select: SyncSelector<TState, TParent>;
}

type Hydrate<TState extends Real> =
  | HydrateTask<TState>
  | HydrateActionCreator<TState>;
type HydrateTask<TState extends Real> = (
  state: TState
) => (dispatch: Dispatch) => void;
type HydrateActionCreator<TState extends Real> = (
  state: TState
) => PayloadAction<TState>;

type Nullish<T> = T | null | undefined;

interface SyncOnUpdate<TState> {
  skipSync?: false | undefined;
  owner: OwnerKey;
  state: Nullish<TState>;
}

interface SyncOffUpdate<TState> {
  skipSync: true;
  owner?: Nullish<OwnerKey>;
  state?: Nullish<TState>;
}

export type SyncUpdate<TState> = SyncOnUpdate<TState> | SyncOffUpdate<TState>;
export type SyncSelector<TState, TParent> = (
  parent: TParent
) => SyncUpdate<TState>;

interface ChangeDetectionConfig<TState> {
  /**
   * Utility option to customize how selected state is compared to a previous one
   */
  readonly compare: (stateA: TState, stateB: TState) => boolean;
}

interface SerializationConfig {
  /**
   * Useful when there's a need to store non-serializable data
   */
  readonly json: Pick<typeof JSON, "parse" | "stringify">;
}

export interface ConfigCreationOptions<TState extends Real, TParent>
  extends SyncConfig<TState, TParent>,
    Partial<ChangeDetectionConfig<TState>>,
    Partial<SerializationConfig> {
  /**
   * Instructs hydration effect how to transform deprecated structure of the data to the one current version
   * of the app expects.
   */
  readonly actualize:
    | VersioningConfigBuilder<TState>
    | VersioningConfig<TState>;
}

export interface Config<TState extends Real, TParent>
  extends VersioningConfig<TState>,
    SyncConfig<TState, TParent>,
    ChangeDetectionConfig<TState>,
    SerializationConfig {
  readonly key: StorageKey;
  readonly storage: WebStorage;
}
