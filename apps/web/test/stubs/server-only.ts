/**
 * Inert stand-in for the `server-only` marker package, aliased in
 * `vitest.config.mts`. The real package throws on import outside a React
 * Server Component graph, which would make every `src/lib` module that
 * marks itself server-only unimportable from a spec. Nothing is exported —
 * the import exists purely for its (absent) side effect.
 */
export {};
