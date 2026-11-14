const ALLOWED_ENTITY_DOMAINS = new Set(['binary_sensor', 'light', 'sensor', 'switch']);
const MAX_ALLOWED_ENTITIES = 50;

export function readHomeAssistantConfiguration(environment = process.env) {
  const rawUrl = String(environment.HOME_ASSISTANT_URL || '').trim();
  const token = String(environment.HOME_ASSISTANT_TOKEN || '').trim();
  const rawEntities = String(environment.HOME_ASSISTANT_ENTITIES || '').trim();
  const rawControlEntities = String(environment.HOME_ASSISTANT_CONTROL_ENTITIES || '').trim();
  if (!rawUrl && !token && !rawEntities && !rawControlEntities) return null;
  if (!rawUrl || !token || !rawEntities) {
    throw new Error('Home Assistant requires a server URL, token, and entity allowlist.');
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Home Assistant URL is invalid.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('Home Assistant URL must be an http(s) origin without credentials or a path.');
  }

  const entities = [...new Set(rawEntities.split(',').map((entry) => entry.trim()).filter(Boolean))];
  if (!entities.length || entities.length > MAX_ALLOWED_ENTITIES || entities.some((entityId) => {
    const [domain, objectId, ...extra] = entityId.split('.');
    return extra.length > 0 || !ALLOWED_ENTITY_DOMAINS.has(domain) || !/^[a-z0-9_]+$/i.test(objectId || '');
  })) {
    throw new Error('Home Assistant entity allowlist contains an unsupported entity.');
  }
  const controlEntities = [...new Set(rawControlEntities.split(',').map((entry) => entry.trim()).filter(Boolean))];
  if (controlEntities.length > MAX_ALLOWED_ENTITIES || controlEntities.some((entityId) => (
    !entities.includes(entityId) || !/^(?:light|switch)\.[a-z0-9_]+$/i.test(entityId)
  ))) {
    throw new Error('Home Assistant control allowlist must contain only allowlisted lights or switches.');
  }

  return { baseUrl: url.origin, token, entities, controlEntities };
}

export function createHomeAssistantClient({
  configuration,
  fetcher = globalThis.fetch,
  timeoutMs = 5_000,
} = {}) {
  if (!configuration || typeof fetcher !== 'function') {
    throw new TypeError('Home Assistant configuration and fetch are required.');
  }

  const readEntity = async (entityId) => {
        let response;
        try {
          response = await fetcher(`${configuration.baseUrl}/api/states/${encodeURIComponent(entityId)}`, {
            headers: {
              accept: 'application/json',
              authorization: `Bearer ${configuration.token}`,
            },
            cache: 'no-store',
            signal: AbortSignal.timeout(timeoutMs),
          });
        } catch (error) {
          throw Object.assign(new Error(error?.name === 'TimeoutError'
            ? 'Home Assistant request timed out.'
            : 'Home Assistant is unreachable.'), {
            status: error?.name === 'TimeoutError' ? 504 : 502,
          });
        }
        if (response.status === 404) return null;
        if (!response.ok) {
          throw Object.assign(new Error('Home Assistant rejected the entity request.'), { status: 502 });
        }

        let state;
        try {
          state = await response.json();
        } catch {
          throw Object.assign(new Error('Home Assistant returned invalid entity data.'), { status: 502 });
        }
        if (!state || state.entity_id !== entityId || typeof state.state !== 'string') return null;
        const friendlyName = typeof state.attributes?.friendly_name === 'string'
          ? state.attributes.friendly_name.trim().slice(0, 120)
          : '';
        return {
          entityId,
          state: state.state.slice(0, 120),
          ...(friendlyName ? { name: friendlyName } : {}),
          ...(configuration.controlEntities?.includes(entityId) ? { canControl: true } : {}),
        };
  };

  return {
    async listEntities() {
      const results = await Promise.all(configuration.entities.map(readEntity));
      return results.filter(Boolean);
    },
    async controlEntity({ entityId, targetState, confirmed } = {}) {
      if (confirmed !== true) {
        throw Object.assign(new Error('Confirm the exact Home Assistant action before sending it.'), { status: 400 });
      }
      if (!configuration.controlEntities?.includes(entityId)) {
        throw Object.assign(new Error('This Home Assistant entity is not approved for control.'), { status: 403 });
      }
      if (!['on', 'off'].includes(targetState)) {
        throw Object.assign(new Error('Home Assistant controls support only explicit on or off actions.'), { status: 400 });
      }
      const domain = entityId.split('.')[0];
      let response;
      try {
        response = await fetcher(`${configuration.baseUrl}/api/services/${domain}/turn_${targetState}`, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${configuration.token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ entity_id: entityId }),
          cache: 'no-store',
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw Object.assign(new Error(error?.name === 'TimeoutError'
          ? 'Home Assistant control request timed out.'
          : 'Home Assistant is unreachable.'), {
          status: error?.name === 'TimeoutError' ? 504 : 502,
        });
      }
      if (!response.ok) {
        throw Object.assign(new Error('Home Assistant rejected the approved device action.'), { status: 502 });
      }
      const current = await readEntity(entityId);
      if (current?.state !== targetState) {
        throw Object.assign(new Error('Home Assistant accepted the action, but the requested state could not be verified.'), { status: 502 });
      }
      return current;
    },
  };
}