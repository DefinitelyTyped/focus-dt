export function tryAdd<T>(set: Set<T>, value: T) {
    const size = set.size;
    set.add(value);
    return set.size > size;
}
