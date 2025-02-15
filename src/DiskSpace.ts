import { Config, Real } from "./Config";

export type DiskSpace<TState extends Real> = ReturnType<
    typeof createDiskSpace<TState, never>
>;
export type OwnerKey = string;

const NAMESPACE = `aRzf3d7co0u-DISK`;

export function createDiskSpace<TState extends Real, TParent>(
    config: Required<Config<TState, TParent>>,
) {
    const { storage, json, version: latestVersion } = config;

    const namespacedKey = `${NAMESPACE}:${config.key}:`;
    const separator = "|";

    return {
        clearAll,
        clear,
        set,
        get,
    };

    function get(owner: OwnerKey) {
        const storedString = storage.getItem(getOwnedKey(owner));
        if (!storedString) return undefined;

        const separatorIdx = storedString.indexOf(separator);

        const version = parseInt(storedString.slice(0, separatorIdx));
        const data: unknown = json.parse(storedString.slice(separatorIdx + 1));

        if (data == null || typeof version !== "number") return undefined;

        return { data, version };
    }

    function set(owner: OwnerKey, state: TState) {
        storage.setItem(
            getOwnedKey(owner),
            latestVersion + separator + json.stringify(state),
        );
    }

    function clear(owner: OwnerKey) {
        storage.removeItem(getOwnedKey(owner));
    }

    function clearAll() {
        for (const owner of getOwners()) {
            storage.removeItem(getOwnedKey(owner));
        }
    }

    function* getOwners() {
        // this must work since storage has a `map` internal property
        // https://html.spec.whatwg.org/multipage/webstorage.html#concept-storage-map
        // support is 98%+ https://caniuse.com/namevalue-storage
        for (const key of Object.keys(storage))
            if (key.startsWith(namespacedKey))
                yield key.replace(namespacedKey, "");
    }

    function getOwnedKey(owner: OwnerKey) {
        return namespacedKey + owner;
    }
}
