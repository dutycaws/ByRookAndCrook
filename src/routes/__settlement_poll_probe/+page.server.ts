import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';

let loadCount = 0;

export function load({ request }: { request: Request }) {
  if (!dev || request.headers.get('x-settlement-poll-probe') !== 'enabled') error(404);
  loadCount += 1;
  return { loadCount };
}
