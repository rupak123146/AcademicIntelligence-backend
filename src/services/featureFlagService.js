/**
 * Feature flags service with env defaults and in-memory overrides.
 */

const DEFAULT_FLAGS = {
  examPreview: true,
  skipQuestion: true,
  realtimeAnalytics: true,
  websocketNotifications: true,
  advancedSearch: true,
  interventionsAndGoals: true,
};

const overrides = new Map();

const parseEnvFlag = (value, fallback) => {
  if (value === undefined) return fallback;
  return String(value).toLowerCase() === 'true';
};

const getFlagValue = (name) => {
  if (overrides.has(name)) {
    return overrides.get(name);
  }
  const envKey = `FEATURE_${name.replace(/[A-Z]/g, (m) => `_${m}`).toUpperCase()}`;
  return parseEnvFlag(process.env[envKey], DEFAULT_FLAGS[name] ?? false);
};

const listFlags = () => Object.keys(DEFAULT_FLAGS).reduce((acc, key) => {
  acc[key] = getFlagValue(key);
  return acc;
}, {});

const setFlag = (name, enabled) => {
  if (!(name in DEFAULT_FLAGS)) {
    return false;
  }
  overrides.set(name, !!enabled);
  return true;
};

module.exports = {
  listFlags,
  getFlagValue,
  setFlag,
};
