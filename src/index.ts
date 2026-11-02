import { RegistryProxy } from './core';
import { cors } from './shared/shared';

export default {
    async fetch(request, env, ctx): Promise<Response> {
        try {
            if (request.method === 'OPTIONS') {
                return cors(new Response(null, { status: 204 }));
            }
            const registryProxy = new RegistryProxy(request);
            return cors(await registryProxy.match());
        } catch (error: any) {
            return cors(new Response(error.message || String(error), { status: 500 }));
        }
    }
} satisfies ExportedHandler<Env>;
