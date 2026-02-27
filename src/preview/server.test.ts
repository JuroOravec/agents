/**
 * Tests for the preview server (Fastify).
 * Uses fastify.inject() for in-process HTTP requests.
 */

import { describe, expect, it } from 'vitest';

import { createPreviewServer } from './server.js';

const repoRoot = process.cwd();

describe('createPreviewServer', () => {
  it('redirects / to /skills', async () => {
    const fastify = createPreviewServer(repoRoot);
    await fastify.ready();
    const res = await fastify.inject({
      method: 'GET',
      url: '/',
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/skills');
  });

  it('serves /skills with HTML', async () => {
    const fastify = createPreviewServer(repoRoot);
    await fastify.ready();
    const res = await fastify.inject({
      method: 'GET',
      url: '/skills',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.payload).toContain('<!DOCTYPE html>');
  });

  it('serves /agents with HTML', async () => {
    const fastify = createPreviewServer(repoRoot);
    await fastify.ready();
    const res = await fastify.inject({
      method: 'GET',
      url: '/agents',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('serves /tools with HTML', async () => {
    const fastify = createPreviewServer(repoRoot);
    await fastify.ready();
    const res = await fastify.inject({
      method: 'GET',
      url: '/tools',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('serves /prompts with HTML', async () => {
    const fastify = createPreviewServer(repoRoot);
    await fastify.ready();
    const res = await fastify.inject({
      method: 'GET',
      url: '/prompts',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('serves /chats with HTML', async () => {
    const fastify = createPreviewServer(repoRoot);
    await fastify.ready();
    const res = await fastify.inject({
      method: 'GET',
      url: '/chats',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('accepts query params on list routes', async () => {
    const fastify = createPreviewServer(repoRoot);
    await fastify.ready();
    const res = await fastify.inject({
      method: 'GET',
      url: '/skills?page=2&sort=-created_at&filter=obj.skill',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('returns 404 for unknown chat id', async () => {
    const fastify = createPreviewServer(repoRoot);
    await fastify.ready();
    const res = await fastify.inject({
      method: 'GET',
      url: '/chats/nonexistent-id-12345',
    });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.payload).toContain('Chat not found');
  });
});
