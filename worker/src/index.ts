export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
}

export default {
  async fetch(): Promise<Response> {
    return new Response("careers10ai Worker scaffold", {
      status: 501,
      headers: {
        "content-type": "text/plain; charset=utf-8"
      }
    });
  }
} satisfies ExportedHandler<Env>;
