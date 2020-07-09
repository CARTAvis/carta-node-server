# CARTA Server (NodeJS version)

## Work-in-progress, documentation still under construction

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
