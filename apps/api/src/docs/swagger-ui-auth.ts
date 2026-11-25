/**
 * Browser-side Swagger UI plugin, served inline with the docs page.
 *
 * The page starts with an empty "shell" document whose only content is the Keycloak OAuth2 scheme. When the user
 * signs in through Authorize → keycloak (authorization code + PKCE), Swagger UI stores the token via
 * authActions.authorizeOauth2; this plugin wraps that action, fetches the real spec with the token, swaps it in and
 * pre-fills the `bearer` scheme so "Try it out" sends the same token. Without a token the spec is never fetched.
 *
 * Plain ES5-style JavaScript on purpose: it runs as-is in the browser and is not compiled.
 */
export function swaggerUiAuthScript(specUrl: string): string {
  return `
window.SimoesDocsAuth = function () {
  var specUrl = ${JSON.stringify(specUrl)};
  function report(system, message) {
    console.error('[API docs] ' + message);
    system.errActions.newAuthErr({ authId: 'keycloak', level: 'error', source: 'auth', message: message });
  }
  function loadSpec(system, token) {
    fetch(specUrl, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }, credentials: 'omit' })
      .then(function (response) {
        if (response.status === 401) throw new Error('A sessão não foi aceite pela API (401). Volta a entrar.');
        if (response.status === 403) throw new Error('A documentação da API requer o papel ADMIN (403).');
        if (!response.ok) throw new Error('Não foi possível carregar a especificação (' + response.status + ').');
        return response.text();
      })
      .then(function (text) {
        system.specActions.updateSpec(text);
        system.authActions.authorize({ bearer: { name: 'bearer', schema: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, value: token } });
      })
      .catch(function (error) { report(system, error && error.message ? error.message : String(error)); });
  }
  return {
    statePlugins: {
      auth: {
        wrapActions: {
          authorizeOauth2: function (oriAction, system) {
            return function (payload) {
              var result = oriAction(payload);
              var token = payload && payload.token && payload.token.access_token;
              if (token) loadSpec(system, token);
              return result;
            };
          },
        },
      },
    },
  };
};
`;
}
