const appJson = require('./app.json');

module.exports = ({ config }) => {
  const base = appJson.expo;
  const variant = process.env.APP_VARIANT || 'preview';
  const isDev = variant === 'dev';

  const androidPackage = isDev
    ? `${base.android.package}.dev`
    : base.android.package;

  return {
    ...config,
    ...base,
    name: isDev ? `${base.name}-dev` : base.name,
    slug: isDev ? `${base.slug}-dev` : base.slug,
    android: {
      ...base.android,
      package: androidPackage,
    },
    extra: {
      ...base.extra,
      appVariant: variant,
    },
  };
};
