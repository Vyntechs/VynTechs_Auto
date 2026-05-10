// TEMP debug endpoint — DO NOT COMMIT. Verifies that streaming works
// from a Next.js Node-runtime route on this project's setup. Emits 5
// JSON-line events 500ms apart. If `curl --no-buffer` shows them
// arrive over time, streaming is fine. If they all arrive at once at
// the end, something in our stack is buffering the response.

export const runtime = 'nodejs'

export async function GET() {
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      for (let i = 1; i <= 5; i++) {
        controller.enqueue(
          encoder.encode(
            JSON.stringify({ idx: i, t: Date.now() }) + '\n',
          ),
        )
        await new Promise((r) => setTimeout(r, 500))
      }
      controller.close()
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
