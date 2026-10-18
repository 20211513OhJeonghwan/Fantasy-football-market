/** Expose only total handler duration, never query text, identities or secrets. */
export async function timedRead(operation: () => Promise<Response>) {
  const start=performance.now();
  const response=await operation();
  response.headers.set('Server-Timing',`app;dur=${(performance.now()-start).toFixed(1)}`);
  return response;
}
