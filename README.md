# CARTA Server (NodeJS version)

#### Work-in-progress, documentation still under construction

## Introduction
Provides a simple dashboard for authenticating users, starting up a CARTA backend process as the authenticated user, serving static frontend code to clients and a dynamic proxy to redirect authenticated client connections to the appropriate backend process. Authentication can either be handled by the server itself, or by an external OAuth2-based authentication server.

## Dependencies
In order to serve CARTA sessions, the CARTA backend must be executable by the server. This can be in the form of a compiled executable or a container.
The `dev` branch of [carta-backend](https://github.com/CARTAvis/carta-backend) should be used. 
The CARTA frontend must be built and either copied or symlinked inside this repo's `public` folder as `frontend`. The `angus/database_service` branch should be used.

By default, the server runs on port 8000. It should be run behind a proxy, so it can be accessed via HTTP and HTTPS. 

MongoDB is required for storing user preferences, layouts and (in the near future) server metrics.
A working NodeJS installation with NPM is required. All node dependencies should be installed by `npm install`.

## Authentication support
`carta-node-server` supports three modes for authentication. All three modes use refresh and access tokens stored in [JWT](https://jwt.io/) format, based on the [OAuth2 Authorization flow](https://tools.ietf.org/html/rfc6749#section-1.3.1). The modes are:
- **LDAP-based authentication**: An existing LDAP server is used for user authentication. After the user's username and password configuration are validated by the LDAP server, `carta-node-server` returns a long-lived refresh token, signed with a private key, that can be exchanged by the CARTA dashboard, or the CARTA frontend client for a short-lived access token.
- **Google authentication**: Google's authentication libraries are used for handling authentication. In order to use this, a new web application must be created in the [Google API console](https://console.developers.google.com/apis/credentials). The client ID provided by this application must be used in a number of places during the configuration.
* **External authentication**: Allows users to authenticate with some external OAuth2-based authentication system. This requires a fair amount of configuration, and has not been well-tested. It is assumed that the refresh token passed by the authentication system is stored as an `HttpOnly` cookie.

Placeholder authentication (accepting any username and password) is also included, but should not be used on anything other than test deployments.

A private/public key pair in PEM format can be generated using `ssh-keygen` or `openssl`:
```shell script
ssh-keygen -t rsa -b 4096 -m PEM -f carta_rsa.key
openssl rsa -in carta_rsa.key -pubout -outform PEM -out carta_rsa.key.pub
```

## Configuration
Both the server and the frontend need to be configured correctly according to the authentication approach used.

### Frontend Configuration
Frontend configuration should be provided by modifying the [runtimeConfig.js](config/runtimeConfig.js.stub) after the built frontend has been placed in the `public/frontend` directory. If using google authentication, the following configuration options are required:
```javascript
window["cartaRuntimeConfig"] = {
    // Common properties
    dashboardAddress: "https://my-carta-server.com",
    apiAddress: "https://my-carta-server.com/api",

    // Required for Google auth
    googleClientId: "<clientID>.apps.googleusercontent.com",
}
```
If using LDAP-based or external authentication, the addresses of the refresh endpoint and (optionally) logout endpoint must be provided:
```javascript
window["cartaRuntimeConfig"] = {
    // Common properties
    dashboardAddress: "https://my-carta-server.com",
    apiAddress: "https://my-carta-server.com/api",

    // Required for LDAP and external auth
    tokenRefreshAddress: "https://my-carta-server.com/api/auth/refresh",
    logoutAddress: "https://my-carta-server.com/api/auth/logout"
}
```

### Server Configuration
Server configuration is handled by a configuration file `config/config.ts`. Detailed comments on each of the server options are given in the [example config](config/config.ts.stub). For external authentication systems, you may need to translate a unique ID (such as email or username) from the authenticated user information to the system user. This can be performed by providing a [user lookup table](config/usertable.txt.stub), which is watched by the server and reloaded whenever it is updated.

If using Google authentication, there are some lines that need to be uncommented in the `<head>` section of the [public/index.html](public/index.html) file.

### System Configuration
The CARTA server will attempt to start up a `carta_backend` process as the authenticated user. In order to do this, the user under which the server is running (assumed to be `carta`) needs to be given permission to start the backend process as any authorised user, and to stop any `carta_backend` processes on the system. Both are handled via running commands via `sudo -u <user>`. Rather than allowing the `carta` user to kill all processes beloning to authorised users, a [kill script](scripts/kill_script.sh) is used, which is only able to kill processes matching the name `carta_backend`. In order to provide the `carta` user with these privledges, modifications to the [sudoers configuration](https://www.sudo.ws/man/1.9.0/sudoers.man.html) must be made. An [example sudoers config](config/example_sudoers_conf.stub) is given. This is designed to allow the `carta` user to only run `carta_backend` as users belonging to a specific group (assumed to be `carta-users`), in order to prevent access to unauthorized accounts. **Please only edit your sudoers configuration with `visudo` or equivalent.**

If using [nginx](https://www.nginx.com/) as a proxy, the following configuration example can be used as a starting point to redirect traffic from port 8000 to port 80:

```nginx
server {
    listen 80;
    server_name my-carta-server.com;
    location / {
        proxy_set_header   X-Forwarded-For $remote_addr;
        proxy_pass http://localhost:8000/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

We strongly suggest serving over HTTPS and redirecting HTTP traffic to HTTPS, especially if handling authentication internally. In order to do this, nginx needs additional configuration and a certificate pair (assumed to be stored in `/etc/nginx/ssl` with the correct file permissions). As an example:

```nginx
server {
    listen 443 ssl;
    ssl on;
    server_name my-carta-server.com;
    ssl_certificate /etc/nginx/ssl/cert.pem; 
    ssl_certificate_key /etc/nginx/ssl/key.pem;
    location / {
        proxy_set_header   X-Forwarded-For $remote_addr;
        proxy_pass http://localhost:8000/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}

server {
    server_name my-carta-server.com;    
    if ($host = my-carta-server.com) {
        return 301 https://$host$request_uri;
    }
    listen 80 ;
    listen [::]:80 ;
    return 404;
}
```

Other HTTP servers, such as Apache, may also be used. Please ensure that they are set up to forward both standard HTTP requests and WebSocket traffic to the correct port.

By default, the configuration attempts to write log files to the `/var/log/carta` directory. Please ensure this directory exists and the `carta` user has write permission.

## Running the server
- Build [carta-backend](https://github.com/CARTAvis/carta-backend) using the `dev` branch (or create the appropriate container)
- Configure and build [carta-frontend](https://github.com/CARTAvis/carta-frontend) using the `angus/database_service` branch.
- Edit the server configuration file
- Perform system configuration

After building the frontend and backend, and editing the server configuration, the server can be started by simply running `npm run start` to start the server. In order to keep the server running, a utility such as [forever](https://github.com/foreversd/forever) can be used to automatically restart it.

## Getting help
If there are issues with the server or documentation, please submit an issue in this repo. If you need assistance in configuration or deployment, please contact the [CARTA helpdesk](mailto:carta_helpdesk@asiaa.sinica.edu.tw).

## TODO
Still to be implemented:
- Better error feedback
- More flexibility with external auth
- API endpoints for saving user layouts (not currently implemented)
