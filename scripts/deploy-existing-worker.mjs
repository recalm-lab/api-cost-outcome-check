// Legacy deployment is disabled: it cannot verify the existing remote mode before Wrangler upload.
// Use the reviewed scoped sandbox uploader; live-closed upload is not implemented.
throw new Error('legacy_deployment_disabled_use_scoped_uploader');
