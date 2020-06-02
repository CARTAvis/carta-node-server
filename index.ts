import * as express from "express";
import * as bodyParser from "body-parser";
import * as cookieParser from "cookie-parser";
import * as jwt from "jsonwebtoken";
import * as fs from "fs";
import {spawn, spawnSync, ChildProcess} from "child_process";

// Simple type intersection for adding custom username field to an express request
type AuthenticatedRequest = express.Request & { username?: string, jwt?: string };

// Auth config
const config = require("./config.ts");
const publicKey = fs.readFileSync(config.publicKeyLocation);

// Child processes
const childMap = new Map<string, ChildProcess>();

let app = express();
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());
app.use(cookieParser());

const delay = async (delay: number) => {
    return new Promise<void>(resolve => {
        setTimeout(() => resolve(), delay);
    })
}

// Optional login route that uses a private key to sign a JWT after authorising
if (config.handleTokenSigning) {
    const privateKey = fs.readFileSync(config.privateKeyLocation);
    const handleLogin = (req, res) => {
        if (!req.body) {
            res.status(400).json({success: false, message: "Malformed login request"});
            return;
        }

        const username = req.body.username;
        const password = req.body.password;
        // Dummy auth
        if (username !== config.dummyUsername || password !== config.dummyPassword) {
            res.status(403).json({success: false, message: "Invalid username/password combo"});
        } else {
            const token = jwt.sign({
                username: username,
                backendSocket: config.backendSocket
            }, privateKey, {algorithm: config.keyAlgorithm, expiresIn: '1h'});
            res.cookie(config.tokenName, token, {maxAge: 1000 * 60 * 60});
            res.json({success: true, message: "Successfully authenticated"});
        }
    }
    app.post("/login", handleLogin);
} else {
    app.post("/login", ((req, res) => {
        res.status(400).json({success: false, message: "Login not implemented"});
    }))
}

// This can easily be replaced by another strategy for getting the token from a request
const getTokenFromCookie = (req: express.Request) => {
    return req.cookies?.[config.tokenName];
}

const getTokenFromBody = (req: express.Request) => {
    return req.body?.token;
}

const getToken = getTokenFromCookie;

// Express middleware to guard against unauthorized access. Writes the username and jwt to the request object
const authGuard = (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
    const tokenCookie = getToken(req);
    if (tokenCookie) {
        try {
            const token = jwt.verify(tokenCookie, publicKey, {algorithm: config.keyAlgorithm});
            req.username = token.username;
            req.jwt = tokenCookie;
            next();
        } catch (err) {
            res.json({success: false, message: err});
        }
    } else {
        res.status(403).json({success: false, message: "Not authorized"});
    }
}

const handleStatus = (req: AuthenticatedRequest, res: express.Response) => {
    res.json({
        success: true,
        username: req.username,
    });
}

const handleStart = async (req: AuthenticatedRequest, res: express.Response) => {
    if (!req.username) {
        res.status(400).json({success: false, message: "Invalid username"});
    }

    // Kill existing backend process for this
    try {
        const currentChild = childMap.get(req.username);
        if (currentChild) {
            // Kill the process via the kill script
            spawnSync("sudo", ["-u", `${req.username}`, config.killCommand, `${currentChild.pid}`]);
            // Delay to allow the parent process to exit
            await delay(10);
            childMap.delete(req.username);
        }
    } catch (e) {
        console.log(`Error killing existing process belonging to user ${req.username}`);
        res.status(400).json({success: false, message: "Problem killing existing process"});
        return;
    }

    // Spawn a new process
    try {
        const child = spawn("sudo", ["-u", `${req.username}`, config.processCommand, "-port", `${config.backendPort}`]);
        child.stdout.on("data", data => console.log(data.toString()));

        // Check for early exit of backend process
        await delay(config.startDelay);
        if (child.exitCode || child.signalCode) {
            res.status(400).json({success: false, message: `Process terminated within ${config.startDelay} ms`});
        } else {
            console.log(`Started process with PID ${child.pid} for user ${req.username}`);
            childMap.set(req.username, child);
            res.json({success: true, username: req.username, token: req.jwt});
        }
    } catch (e) {
        console.log(`Error killing existing process belonging to user ${req.username}`);
        res.status(400).json({success: false, message: `Problem starting process for user ${req.username}`});
        return;
    }
}

app.post("/start", authGuard, handleStart);
app.get("/checkStatus", authGuard, handleStatus);

app.listen(config.serverPort, () => console.log(`Started listening for login requests on port ${config.serverPort}`));