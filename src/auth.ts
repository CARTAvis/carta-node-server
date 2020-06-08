import * as fs from "fs";
import * as jwt from "jsonwebtoken";
import * as express from "express";
import * as userid from "userid";
import {OAuth2Client} from "google-auth-library";

export type RequestHandler = (req: express.Request, res: express.Response) => void;
export type AuthenticatedRequest = express.Request & { username?: string, jwt?: string };

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

if (config.authProviders.local) {
    const authConf = config.authProviders.local;
    const publicKey = fs.readFileSync(authConf.publicKeyLocation);
    tokenVerifiers.set(authConf.issuer, (cookieString) => {
        const payload = jwt.verify(cookieString, publicKey, {algorithm: authConf.keyAlgorithm});
        if (payload && payload.iss === authConf.issuer) {
            return payload;
        } else {
            return undefined;
        }
    });
}

if (config.authProviders.google) {
    const authConf = config.authProviders.google;
    const validIssuers = ["accounts.google.com", "https://accounts.google.com"]
    const googleAuthClient = new OAuth2Client(authConf.googleClientId);
    const verifier = async (cookieString) => {
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
    const verifier = (cookieString) => {
        const payload = jwt.verify(cookieString, publicKey, {algorithm: authConf.keyAlgorithm});
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
    const tokenJson = jwt.decode(cookieString);
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

// This can easily be replaced by another strategy for getting the token from a request. However, it's
// easier to user cookies for the websocket proxy, since we can't specify custom headers in the browser.
function getToken(req: express.Request) {
    return req.cookies?.["CARTA-Authorization"];
}

// Express middleware to guard against unauthorized access. Writes the username and jwt to the request object
export async function authGuard(req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) {
    const tokenCookie = getToken(req);
    if (tokenCookie) {
        try {
            const token = await verifyToken(tokenCookie);
            if (!token || !token.username) {
                res.status(403).json({success: false, message: "Not authorized"});
            } else {
                req.username = getUser(token.username, token.iss);
                req.jwt = tokenCookie;
                next();
            }
        } catch (err) {
            res.json({success: false, message: err});
        }
    } else {
        res.status(403).json({success: false, message: "Not authorized"});
    }
}


let loginHandler: RequestHandler;

if (config.authProviders.local) {
    const authConf = config.authProviders.local;
    const privateKey = fs.readFileSync(authConf.privateKeyLocation);

    loginHandler = (req: express.Request, res: express.Response) => {
        if (!req.body) {
            res.status(400).json({success: false, message: "Malformed login request"});
            return;
        }

        let username = req.body.username;
        const password = req.body.password;

        // Dummy auth: always accept as long as password matches dummy password
        if (!username || password !== authConf.dummyPassword) {
            res.status(403).json({success: false, message: "Invalid username/password combo"});
        } else {
            // verify that user exists on the system
            try {
                const uid = userid.uid(username);
                console.log(`Authenticated as user ${username} with uid ${uid}`);
                const token = jwt.sign({iss: authConf.issuer, username}, privateKey, {
                    algorithm: authConf.keyAlgorithm,
                    expiresIn: '1h'
                });
                res.cookie("CARTA-Authorization", token, {maxAge: 1000 * 60 * 60});
                res.json({success: true, message: "Successfully authenticated"});
            } catch (e) {
                res.status(403).json({success: false, message: "Invalid username/password combo"});
            }
        }
    };
} else {
    loginHandler = (req, res) => {
        res.status(400).json({success: false, message: "Login not implemented"});
    };
}

function handleCheckAuth(req: AuthenticatedRequest, res: express.Response) {
    res.json({
        success: true,
        username: req.username,
    });
}

const authRouter = express.Router();
authRouter.post("/login", loginHandler);
authRouter.get("/checkAuth", authGuard, handleCheckAuth);

export const authRoutes = authRouter;