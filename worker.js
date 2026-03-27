import { Buffer } from 'node:buffer';
import process from 'node:process';
import { PassThrough } from 'node:stream';

// Polyfill globals for legacy libraries
globalThis.Buffer = Buffer;
globalThis.process = process;

// Fix for "Illegal invocation" error caused by Axios calling fetch without correct context
const boundFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = boundFetch;

/**
 * Robust adapter to run an Express app on Cloudflare Workers.
 * Replicates the routing rules from vercel.json.
 */
const expressApp = require('./app');

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        let pathname = url.pathname;

        // --- Replicate Vercel Routing logic from vercel.json ---
        // Vercel routes for /entities, /explore, /youtube, /jiosaavn all go to /api/app
        // In the Express app, these are mounted under '/api'. 
        // Prepend '/api' if missing for these paths to ensure alignment.
        const vercelRedirects = ['/entities', '/explore', '/youtube', '/jiosaavn'];
        if (vercelRedirects.some(path => pathname.startsWith(path))) {
            pathname = '/api' + pathname;
        }

        // Handle root redirect (if not covered by Express)
        if (pathname === '/') {
            return Response.redirect('https://shashwat-coding.github.io/ytify-backend', 302);
        }

        return new Promise(async (resolve, reject) => {
            try {
                // Prepare headers
                const reqHeaders = Object.fromEntries(request.headers);

                // Create a Node-style stream for the request body
                const reqStream = new PassThrough();
                
                // Copy Request properties to the stream object to act as 'req'
                reqStream.method = request.method;
                reqStream.url = pathname + url.search;
                reqStream.headers = reqHeaders;
                reqStream.query = Object.fromEntries(url.searchParams);
                reqStream.ip = request.headers.get('cf-connecting-ip') || '';
                reqStream.protocol = 'https';
                reqStream.secure = true;
                reqStream.app = expressApp;

                // Pipe the response body to the resolver
                let resStatusCode = 200;
                let resHeaders = new Headers({
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
                });

                // Mock Node.js Response
                const res = {
                    statusCode: 200,
                    _headers: {},
                    setHeader(name, value) {
                        resHeaders.set(name, value);
                    },
                    getHeader(name) {
                        return resHeaders.get(name);
                    },
                    getHeaders() {
                        return Object.fromEntries(resHeaders.entries());
                    },
                    status(code) {
                        this.statusCode = code;
                        resStatusCode = code;
                        return this;
                    },
                    // Used by Express to send the final response
                    send(body) {
                        resolve(new Response(body, {
                            status: this.statusCode,
                            headers: resHeaders
                        }));
                    },
                    json(data) {
                        this.setHeader('Content-Type', 'application/json');
                        this.send(JSON.stringify(data));
                    },
                    end(data) {
                        this.send(data);
                    },
                    redirect(url) {
                        resolve(Response.redirect(url, 302));
                    },
                    set(name, value) {
                        this.setHeader(name, value);
                        return this;
                    },
                    // Other common Express response methods
                    type(t) {
                        this.setHeader('Content-Type', t);
                        return this;
                    }
                };

                // Add compatibility for some Express middlewares
                res.once = () => {};
                res.on = () => {};
                res.emit = () => {};

                // Handle POST/PUT body streaming
                if (request.body) {
                    const reader = request.body.getReader();
                    const pump = async () => {
                        const { done, value } = await reader.read();
                        if (done) {
                            reqStream.end();
                            return;
                        }
                        reqStream.write(value);
                        pump();
                    };
                    pump().catch(err => {
                        console.error('[WORKER] Error pumping request body:', err);
                        reqStream.destroy(err);
                    });
                } else {
                    reqStream.end();
                }

                // Call the Express app
                expressApp(reqStream, res);
            } catch (err) {
                console.error('[WORKER] Generic Error:', err);
                resolve(new Response(JSON.stringify({ error: err.message }), { 
                    status: 500,
                    headers: { 'Content-Type': 'application/json' }
                }));
            }
        });
    }
};
