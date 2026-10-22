/**
 * Entry point for clients that only need the domain model and the time
 * helpers — specifically the Fire TV app, which renders server state and
 * validates nothing, so it has no use for zod. Keeping this separate keeps a
 * validation library out of the television bundle.
 */
export * from './domain.js';
export * from './time.js';
