import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { portraitJobIsTerminal } from '$lib/server/community-npc-workspace';
import { portraitJobEventSnapshot } from '$lib/server/community-npc-jobs/portrait-status';

const encoder = new TextEncoder();
const WAIT_MS = 1_000;
const HEARTBEAT_MS = 15_000;

function sameOrigin(request: Request, url: URL): boolean {
  const origin = request.headers.get('origin');
  return origin === url.origin;
}

function eventPayload(snapshot: NonNullable<Awaited<ReturnType<typeof portraitJobEventSnapshot>>>, sequence: number) {
  // This DTO is intentionally narrower than the JSON snapshot. Never add
  // previews, hashes, prompt content, object keys, or provider diagnostics.
  return JSON.stringify({
    sequence,
    jobId: snapshot.jobId,
    slot: snapshot.slot,
    status: snapshot.status,
    alternatives: snapshot.alternatives.map(({ ordinal, stage, status, candidateId, errorCode }) => ({ ordinal, stage, status, candidateId, errorCode }))
  });
}
function stateSignature(snapshot: NonNullable<Awaited<ReturnType<typeof portraitJobEventSnapshot>>>) {
  return JSON.stringify({ jobId: snapshot.jobId, slot: snapshot.slot, status: snapshot.status, alternatives: snapshot.alternatives });
}

export const GET: RequestHandler = async ({ locals, params, request, url }) => {
  if (!sameOrigin(request, url)) return json({ message: 'Invalid request origin.' }, { status: 403 });
  if (!await locals.getVerifiedUser()) return json({ message: 'Please sign in.' }, { status: 401 });
  const initial = await portraitJobEventSnapshot(locals, params.npcId, params.jobId);
  if (!initial) return json({ message: 'Portrait job not found.' }, { status: 404 });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let sequence = 0;
      let last = '';
      let lastHeartbeat = Date.now();
      let closed = false;
      const close = () => { if (!closed) { closed = true; controller.close(); } };
      const emit = (snapshot: typeof initial) => {
        const payload = eventPayload(snapshot, ++sequence);
        last = stateSignature(snapshot);
        controller.enqueue(encoder.encode(`event: portrait-job\ndata: ${payload}\n\n`));
      };
      emit(initial);
      if (portraitJobIsTerminal(initial.status)) return close();
      try {
        while (!request.signal.aborted) {
          await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
          if (request.signal.aborted) break;
          // Recheck authenticated ownership on every poll before reading a
          // status change. Revoked access ends the stream rather than leaking
          // a final state after the caller loses permission.
          const next = await portraitJobEventSnapshot(locals, params.npcId, params.jobId);
          if (!next) break;
          const probe = stateSignature(next);
          if (probe !== last) emit(next);
          if (Date.now() - lastHeartbeat >= HEARTBEAT_MS) {
            controller.enqueue(encoder.encode(': heartbeat\n\n'));
            lastHeartbeat = Date.now();
          }
          if (portraitJobIsTerminal(next.status)) break;
        }
      } catch {
        // The JSON snapshot remains the bounded recovery path if the stream
        // is interrupted. Do not serialize internal transport errors.
      } finally { close(); }
    },
    cancel() { /* Request abort stops the async loop on its next bounded tick. */ }
  });
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no'
    }
  });
};
