import * as fs from "fs";
import * as url from "url";
import * as jwt from "jsonwebtoken";
import * as express from "express";
import * as userid from "userid";
import * as LdapAuth from "ldapauth-fork";
import {OAuth2Client} from "google-auth-library";
import {VerifyOptions} from "jsonwebtoken";
import ms = require('ms');
import {noCache} from "./util";
import {RequestHandler, AsyncRequestHandler, AuthenticatedRequest, Verifier, UserMap, CartaLdapAuthConfig} from "./types";
import {ServerConfig, RuntimeConfig} from "./config";

// maps JWT claim "iss" to a token verifier
const tokenVerifiers = new Map<string, Verifier>();
// maps JWT claim "iss" to a user map
const userMaps = new Map<string, UserMap>();

// Authentication schemes may have multiple valid issuers
function readUserTable(issuer: string | string[], filename: string) {
    const userMap = new Map<string, string>();
    try {
        const contents = fs.readFileSync(filename).toString();
        const lines = contents.split("\n");
        for (let line of lines) {
            line = line.trim();

            // Skip comments
            if (line.startsWith("#")) {
                continue;
            }

            // Ensure line is in format <username1> <username2>
            const entries = line.split(" ");
            if (entries.length !== 2) {
                console.log(`Ignoring malformed usermap line: ${line}`);
                continue;
            }
            userMap.set(entries[0], entries[1]);
        }
        console.log(`Updated usermap with ${userMap.size} entries`);
    } catch (e) {
        console.log(`Error reading user table`);
    }

    if (Array.isArray(issuer)) {
        for (const iss of issuer) {
            userMaps.set(iss, userMap);
        }
    } else {
        userMaps.set(issuer, userMap);
    }
}

let authPath: string | null;
if (RuntimeConfig.tokenRefreshAddress) {
    const authUrl = url.parse(RuntimeConfig.tokenRefreshAddress);
    authPath = authUrl.pathname;
}


function generateLocalVerifier(authConf: CartaLdapAuthConfig) {
    const publicKey = fs.readFileSync(authConf.publicKeyLocation);
    tokenVerifiers.set(authConf.issuer, (cookieString) => {
        const payload: any = jwt.verify(cookieString, publicKey, {algorithm: authConf.keyAlgorithm} as VerifyOptions);
        if (payload && payload.iss === authConf.issuer) {
            return payload;
        } else {
            return undefined;
        }
    });
}

// Local providers
if (ServerConfig.authProviders.ldap) {
    generateLocalVerifier(ServerConfig.authProviders.ldap);
}

if (ServerConfig.authProviders.google) {
    const authConf = ServerConfig.authProviders.google;
    const validIssuers = ["accounts.google.com", "https://accounts.google.com"]
    const googleAuthClient = new OAuth2Client(authConf.clientId);
    const verifier = async (cookieString: string) => {
        const ticket = await googleAuthClient.verifyIdToken({
            idToken: cookieString,
            audience: authConf.clientId
        });
        const payload = ticket.getPayload();

        // Use either the email or the unique sub ID as the username
        const username = authConf.useEmailAsId ? payload?.email : payload?.sub;

        // check that username exists and email is verified
        if (!username || !payload?.email_verified) {
            console.log("Google auth rejected due to lack of unique ID or email verification");
            return undefined;
        }

        // check that domain is valid
        if (authConf.validDomain && authConf.validDomain !== payload.hd) {
            console.log(`Google auth rejected due to incorrect domain: ${payload.hd}`);
            return undefined;
        }

        return {...payload, username};
    };

    for (const iss of validIssuers) {
        tokenVerifiers.set(iss, verifier);
    }

    if (authConf.userLookupTable) {
        readUserTable(validIssuers, authConf.userLookupTable);
        fs.watchFile(authConf.userLookupTable, () => readUserTable(validIssuers, authConf.userLookupTable));
    }
}

if (ServerConfig.authProviders.external) {
    const authConf = ServerConfig.authProviders.external;
    const publicKey = fs.readFileSync(authConf.publicKeyLocation);
    const verifier = (cookieString: string) => {
        const payload: any = jwt.verify(cookieString, publicKey, {algorithm: authConf.keyAlgorithm} as VerifyOptions);
        if (payload && payload.iss && authConf.issuers.includes(payload.iss)) {
            // substitute unique field in for username
            if (authConf.uniqueField) {
                payload.username = payload[authConf.uniqueField];
            }
            return payload;
        } else {
            return undefined;
        }
    };

    for (const iss of authConf.issuers) {
        tokenVerifiers.set(iss, verifier);
    }

    const tablePath = authConf.userLookupTable;
    if (tablePath) {
        readUserTable(authConf.issuers, tablePath);
        fs.watchFile(tablePath, () => readUserTable(authConf.issuers, tablePath));
    }
}

// Check for empty token verifies
if (!tokenVerifiers.size) {
    console.error("No valid token verifiers specified");
    process.exit(1);
}

export async function verifyToken(cookieString: string) {
    const tokenJson: any = jwt.decode(cookieString);
    if (tokenJson && tokenJson.iss) {
        const verifier = tokenVerifiers.get(tokenJson.iss);
        if (verifier) {
            return await verifier(cookieString);
        }
    }
    return undefined;
}

export function getUser(username: string, issuer: string) {
    const userMap = userMaps.get(issuer);
    if (userMap) {
        return userMap.get(username);
    } else {
        return username;
    }
}

// Express middleware to guard against unauthorized access. Writes the username to the request object
export async function authGuard(req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) {
    const tokenString = req.token;
    if (tokenString) {
        try {
            const token = await verifyToken(tokenString);
            if (!token || !token.username) {
                next({statusCode: 403, message: "Not authorized"});
            } else {
                req.username = getUser(token.username, token.iss);
                next();
            }
        } catch (err) {
            next({statusCode: 403, message: err.message});
        }
    } else {
        next({statusCode: 403, message: "Not authorized"});
    }
}


let loginHandler: RequestHandler;
let refreshHandler: AsyncRequestHandler;

if (ServerConfig.authProviders.ldap) {
    const authConf = ServerConfig.authProviders.ldap;
    const privateKey = fs.readFileSync(authConf.privateKeyLocation);

    const ldap = new LdapAuth(authConf.ldapOptions);
    ldap.on('error', err => console.error('LdapAuth: ', err));
    ldap.on('connect', v => console.log(`Ldap connected: ${v}`));
    setTimeout(() => {
        const ldapConnected = (ldap as any)?._userClient?.connected;
        if (ldapConnected) {
            console.log("LDAP connected correctly");
        } else {
            console.error("LDAP not connected!");
        }
    }, 2000);

    loginHandler = (req: express.Request, res: express.Response) => {
        let username = req.body?.username;
        const password = req.body?.password;

        if (!username || !password) {
            throw {statusCode: 400, message: "Malformed login request"};
        }

        ldap.authenticate(username, password, (err, user) => {
            if (err || user?.uid !== username) {
                throw {statusCode: 403, message: "Invalid username/password combo"};
            } else {
                try {
                    const uid = userid.uid(username);
                    console.log(`Authenticated as user ${username} with uid ${uid}`);
                    const refreshToken = jwt.sign({
                            iss: authConf.issuer,
                            username,
                            refreshToken: true
                        },
                        privateKey, {
                            algorithm: authConf.keyAlgorithm,
                            expiresIn: authConf.refreshTokenAge
                        }
                    );
                    res.cookie("Refresh-Token", refreshToken, {
                        path: authPath ?? "",
                        maxAge: ms(authConf.refreshTokenAge as string),
                        httpOnly: true,
                        secure: true,
                        sameSite: "strict"
                    });

                    const access_token = jwt.sign({iss: authConf.issuer, username}, privateKey, {
                        algorithm: authConf.keyAlgorithm,
                        expiresIn: authConf.accessTokenAge
                    });

                    res.json({
                        access_token,
                        token_type: "bearer",
                        expires_in: ms(authConf.accessTokenAge as string) / 1000
                    });
                } catch (e) {
                    throw {statusCode: 403, message: "User does not exist"};
                }
            }
        });
    };
} else {
    loginHandler = (req, res) => {
        throw {statusCode: 501, message: "Login not implemented"};
    };
}

function logoutHandler(req: express.Request, res: express.Response) {
    res.cookie("Refresh-Token", "", {
        path: authPath ?? "",
        maxAge: 0,
        httpOnly: true,
        secure: true,
        sameSite: "strict"
    });
    return res.json({success: true});
}

function generateLocalRefreshHandler(authConf: CartaLdapAuthConfig) {
    const privateKey = fs.readFileSync(authConf.privateKeyLocation);

    return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
        const refreshTokenCookie = req.cookies["Refresh-Token"];

        if (refreshTokenCookie) {
            try {
                const refreshToken = await verifyToken(refreshTokenCookie);
                if (!refreshToken || !refreshToken.username || !refreshToken.refreshToken) {
                    next({statusCode: 403, message: "Not authorized"});
                } else {
                    const uid = userid.uid(refreshToken.username);
                    const access_token = jwt.sign({iss: authConf.issuer, username: refreshToken.username}, privateKey, {
                        algorithm: authConf.keyAlgorithm,
                        expiresIn: authConf.accessTokenAge
                    });
                    console.log(`Refreshed access token for user ${refreshToken.username} with uid ${uid}`);
                    res.json({
                        access_token,
                        token_type: "bearer",
                        username: refreshToken.username,
                        expires_in: ms(authConf.accessTokenAge as string) / 1000
                    });
                }
            } catch (err) {
                next({statusCode: 400, message: "Invalid refresh token"});
            }
        } else {
            next({statusCode: 400, message: "Missing refresh token"});
        }
    }
}

if (ServerConfig.authProviders.ldap) {
    refreshHandler = generateLocalRefreshHandler(ServerConfig.authProviders.ldap);
} else {
    refreshHandler = (req, res) => {
        throw {statusCode: 501, message: "Token refresh not implemented"};
    };
}

function handleCheckAuth(req: AuthenticatedRequest, res: express.Response) {
    res.json({
        success: true,
        username: req.username,
    });
}

export const authRouter = express.Router();
authRouter.post("/login", noCache, loginHandler);
authRouter.post("/logout", noCache, logoutHandler);
authRouter.post("/refresh", noCache, refreshHandler);
authRouter.get("/status", authGuard, noCache, handleCheckAuth);