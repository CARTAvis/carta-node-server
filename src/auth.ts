import * as fs from "fs";
import * as jwt from "jsonwebtoken";
import * as express from "express";
import * as userid from "userid";
import * as LdapAuth from "ldapauth-fork";
import {OAuth2Client} from "google-auth-library";
import {VerifyOptions} from "jsonwebtoken";
import ms = require('ms');
import {noCache} from "./util";


export type RequestHandler = (req: express.Request, res: express.Response) => void;
export type AuthenticatedRequest = express.Request & { username?: string };

// Token verifier function
type Verifier = (cookieString: string) => any;
// Map for looking up system user name from authenticated user name
type UserMap = Map<string, string>;

const config = require("../config/config.ts");

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


function generateLocalVerifier(authConf: { issuer: string, keyAlgorithm: jwt.Algorithm, publicKeyLocation: string }) {
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
if (config.authProviders.ldap) {
    generateLocalVerifier(config.authProviders.ldap);
}

if (config.authProviders.dummy) {
    generateLocalVerifier(config.authProviders.dummy);
}

if (config.authProviders.google) {
    const authConf = config.authProviders.google;
    const validIssuers = ["accounts.google.com", "https://accounts.google.com"]
    const googleAuthClient = new OAuth2Client(authConf.googleClientId);
    const verifier = async (cookieString: string) => {
        const ticket = await googleAuthClient.verifyIdToken({
            idToken: cookieString,
            audience: authConf.googleClientId
        });
        const payload = ticket.getPayload();

        // check that unique ID exists and email is verified
        if (!payload?.sub || !payload?.email_verified) {
            console.log("Google auth rejected due to lack of unique ID or email verification");
            return undefined;
        }

        // check that domain is valid
        if (authConf.validDomains && authConf.validDomains.length && !authConf.validDomains.includes(payload.hd)) {
            console.log(`Google auth rejected due to incorrect domain: ${payload.hd}`);
            return undefined;
        }

        // Google recommends returning the "sub" field as the unique ID
        return {...payload, username: payload.sub};
    };

    for (const iss of validIssuers) {
        tokenVerifiers.set(iss, verifier);
    }

    if (authConf.userLookupTable) {
        readUserTable(validIssuers, authConf.userLookupTable);
        fs.watchFile(authConf.userLookupTable, () => readUserTable(validIssuers, authConf.userLookupTable));
    }
}

if (config.authProviders.external) {
    const authConf = config.authProviders.external;
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

    if (authConf.userLookupTable) {
        readUserTable(authConf.issuers, authConf.userLookupTable);
        fs.watchFile(authConf.userLookupTable, () => readUserTable(authConf.issuers, authConf.userLookupTable));
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
let refreshHandler: RequestHandler;

if (config.authProviders.ldap) {
    const authConf = config.authProviders.ldap;
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
                        path: "/api/auth/refresh",
                        maxAge: ms(authConf.refreshTokenAge as string),
                        httpOnly: true,
                        secure: true,
                        sameSite: "strict"
                    });

                    const access_token = jwt.sign({iss: authConf.issuer, username}, privateKey, {
                        algorithm: authConf.keyAlgorithm,
                        expiresIn: authConf.accessTokenAge
                    });

                    res.json({access_token, token_type: "bearer"});
                } catch (e) {
                    throw {statusCode: 403, message: "User does not exist"};
                }
            }
        });
    };
} else if (config.authProviders.dummy) {
    const authConf = config.authProviders.dummy;
    const privateKey = fs.readFileSync(authConf.privateKeyLocation);

    loginHandler = (req: express.Request, res: express.Response) => {
        let username = req.body?.username;
        const password = req.body?.password;

        if (!username || !password) {
            throw {statusCode: 400, message: "Malformed login request"};
        }

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
                });
            res.cookie("Refresh-Token", refreshToken, {
                path: "/api/auth/refresh",
                maxAge: ms(authConf.refreshTokenAge as string),
                httpOnly: true,
                secure: true,
                sameSite: "strict"
            });

            const access_token = jwt.sign({iss: authConf.issuer, username}, privateKey, {
                algorithm: authConf.keyAlgorithm,
                expiresIn: authConf.accessTokenAge
            });

            res.json({access_token, token_type: "bearer"});
        } catch (e) {
            throw {statusCode: 403, message: "User does not exist"};
        }
    };
} else {
    loginHandler = (req, res) => {
        throw {statusCode: 501, message: "Login not implemented"};
    };
}

function generateLocalRefreshHandler(authConf: { issuer: string, keyAlgorithm: jwt.Algorithm, privateKeyLocation: string, accessTokenAge: string }) {
    const privateKey = fs.readFileSync(authConf.privateKeyLocation);

    return async (req: express.Request, res: express.Response) => {
        const refreshTokenCookie = req.cookies["Refresh-Token"];

        if (refreshTokenCookie) {
            try {
                const refreshToken = await verifyToken(refreshTokenCookie);
                if (!refreshToken || !refreshToken.username || !refreshToken.refreshToken) {
                    res.status(403).json({success: false, message: "Not authorized"});
                } else {
                    const uid = userid.uid(refreshToken.username);
                    const access_token = jwt.sign({iss: authConf.issuer, username: refreshToken.username}, privateKey, {
                        algorithm: authConf.keyAlgorithm,
                        expiresIn: authConf.accessTokenAge
                    });
                    console.log(`Refreshed access token for user ${refreshToken.username} with uid ${uid}`);
                    res.json({access_token, token_type: "bearer", username: refreshToken.username});
                }
            } catch (err) {
                throw {statusCode: 400, message: "Invalid refresh token"};
            }
        } else {
            throw {statusCode: 400, message: "Missing refresh token"};
        }
    }
}

if (config.authProviders.ldap) {
    refreshHandler = generateLocalRefreshHandler(config.authProviders.ldap);
} else if (config.authProviders.dummy) {
    refreshHandler = generateLocalRefreshHandler(config.authProviders.dummy);
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
authRouter.post("/refresh", noCache, refreshHandler);
authRouter.get("/status", authGuard, noCache, handleCheckAuth);