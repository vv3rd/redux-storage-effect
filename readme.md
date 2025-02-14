# Redux Storage Effect

Utility to pick part of the state that should be persisted and not interact directly with storages.

Main idea is that current state should be **synchronized** with storage declaratively instead of manually
invoking function to update storage.

It should not matter to consumers of data whether it is persisted or not, this is why this library only
implements effects that can be run on data updates without affecting state itself.

The `select` function allows to pick data from one or many reducers or transform it in any way.
The `hydrateAction` that is passed to `createPersistEffects` then must have payload of the same type as `select` returns.

## Examples

This is "kitchen sink" example, meant to showcase all the features.

```ts
import {createPersistenceEffects} from '@raison/persist';

const effects = createPersistenceEffects<AppModel>('preferences-key', 'local', {
    hydrate: restoreUserPreferences,

    select(store) {
        return {
            // data to write to storage, setting it to `null` or `undefined` will "synchronize" it with storage - by removing it.
            // use `skipSync` if state no longer contains data but removing it is not desired
            state: {
                primaryCurrency: selectPrimaryCurrency(store)
                colorTheme: selectColorTheme(store)
            },

            // data ownership allows us to store more than one set of data without altering the shape of said data
            // in this example owner is set to username, this will allow user to switch between
            // any number accounts and preferences of one account will not overwrite preferences of another
            owner: selectUsername(store),

            // user is logged out, no need to persist anything
            skipSync: typeof username === 'undefined',
        };
    },

    // by default update effect only writes to storage if `state` has changed, comparison with previous state is done by `Object.is`
    compare: shallowEqual,
});
```

It's fully up to you _when_ to call effects. Calling `update` effect on every state change is a
valid approach since it already handles deduplication and will not do unnecessary writes to storage

```ts
export const initUserPreferencesEffects = (startListening: APpStartListening) => {
    startListening({
        predicate: () => true,
        effect: effects.update.asListener,
    });

    startListening({
        // an action related to business process can be user to trigger hydration
        actionCreator: authActions.loginSuccessful
        effect: effects.hydrate.asListener,
    });
};
```

Alternatively hydration can be called after store is created and initialized

```ts
const store = configureStore({
  /* ... */
});
effects.hydrate(store);
// or
store.dispatch(effects.hydrate.asThunk);
```

Using listeners is a good default approach, but not the only one.
Same thing can be implemented with custom middleware

```ts
const middleware: Middleware = storeAPI => next => action => {
  const output = next(action);
  // effects must be run after reducers to write latest state
  effects.update(storeAPI);
  return output;
};
```

or with completely custom logic

```ts
window.addEventListener("beforeunload", () => {
  store.dispatch(effects.update.asThunk);
});
window.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    store.dispatch(effects.update.asThunk);
  }
});
```

Finally and most importantly hydration action should be handled by reducer.
As per redux [Style Guide](https://redux.js.org/style-guide/#allow-many-reducers-to-respond-to-the-same-action)
it's a good idea to have many reducers all handle the same action separately

```ts
const colorThemeReducer = createReducer("light", ({ addCase }) => {
  addCase(restoreUserPreferences, (state, action) => {
    return action.payload.colorTheme;
  });
});
```

## Actualization

`createPersistenceEffects` has config option `actualize` that provides version manifest builder to help with supporting older versions.
This option is required and must at least define validation function for current version.

It automatically increments current version number starting from **1** based on amount of version.

Each consecutive call to `olderVersion` must provide function-transformer that will re-shape older data to shape of data above (one version newer).

Removing versions when some of them already have been in production will result in version-downgrade which is not supported - persisted data will be reset.
