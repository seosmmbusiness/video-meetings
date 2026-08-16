import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Unmounts anything React Testing Library rendered between tests. Vitest's
// automatic RTL cleanup only runs with `globals: true`, and this project
// imports `describe`/`it`/`expect` explicitly instead, so it's wired by hand.
// Harmless in the `node` environment: nothing was rendered there.
afterEach(() => {
  cleanup();
});
