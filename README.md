# CARTA Server (NodeJS version)

## Work-in-progress, documentation still under construction

## Introduction
Provides a simple dashboard for authenticating users, starting up a CARTA backend process as the authenticated user, serving static frontend code to clients and a dynamic proxy to redirect authenticated client connections to the appropriate backend process.

## Dependencies
In order to serve CARTA sessions, the CARTA backend must be executable by the server. This can be in the form of a compiled executable or a container.
The `dev` branch of [carta-backend](https://github.com/CARTAvis/carta-backend) should be used. 
The CARTA frontend must be built and either copied or symlinked inside this repo's `public` folder as `frontend`. The `angus/database_service` branch should be used, and some configuration via an `.env.local` file is required (discussed below).

By default, the server runs on port 8000. It should be run behind a proxy, so it can be accessed via HTTP and HTTPS. If using nginx, the following configuration example can be used as a starting point to achieve this:
```nginx
server {
    listen 80;
    server_name example.com;
    location / {
        proxy_set_header   X-Forwarded-For $remote_addr;
        proxy_set_header   Host $http_host;
        proxy_pass         "http://127.0.0.1:8000";
    }
}
```
(We strongly suggest serving over HTTPS)

MongoDB is required for storing user preferences, layouts and (in the near future) server metrics.
All node dependencies should be installed by `npm install`.

## Authentication support
`carta-node-server` supports three modes for authentication. All three modes use refresh and access tokens stored in [JWT](https://jwt.io/) format, based on the [OAuth2 Authorization flow](https://tools.ietf.org/html/rfc6749#section-1.3.1). The modes are:
- **LDAP-based authentication**: An existing LDAP server is used for user authentication. After the user's username and password configuration are validated by the LDAP server, `carta-node-server` returns a refresh token, signed with a private key, that can be exchanged by the CARTA dashboard frontend client, or the 
## Configuration
## Installation
Basic example of using JWTs and returning them via cookies. 

To test: 
1. Run `npm install`
2. Copy `config.ts.stub` to `config.ts` and edit if neccessary
3. Run using `npm start`
4. Send a `POST` to `http://localhost:8000/login` with username and password in a JSON body. If the username and password match the dummy values in `config.ts`, the server will respond with `{"success": true}`, and a JWT stored as a cookie.
5. Send a `GET` to `http://localhost:8000/checkStatus`. The server will verify the JWT sent to it as a cookie, and return `{"success": true}` if it is valid.
5. Send a `POST` to `http://localhost:8000/start`. The server will
    * Verify the JWT sent to it as a cookie.
    * Kill any existing process spawned for the given user.
    * Attempt to start the process defined in `config.ts` as the user specified in the JWT
    * Return `{"success": true}` if spawning succeeds.
