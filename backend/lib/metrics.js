const counters = new Map();

export function incr(name) {
  counters.set(name, (counters.get(name) ?? 0) + 1);
}

export function get(name) {
  return counters.get(name) ?? 0;
}

export function snapshot() {
  return Object.fromEntries(counters);
}
