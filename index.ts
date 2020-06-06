import * as express from "express";
import * as bodyParser from "body-parser";
import * as cookieParser from "cookie-parser";
import * as httpProxy from "http-proxy";
import * as cookie from "cookie";
import * as jwt from "jsonwebtoken";
import * as fs from "fs";
import * as userid from "userid";
import {spawn, spawnSync, ChildProcess} from "child_process";

// Simple type intersection for adding custom username field to an express request
type AuthenticatedRequest = express.Request & { username?: string, jwt?: string };

// Auth config
const config = require("./config.ts");
const publicKey = fs.readFileSync(config.publicKeyLocation);

// Child processes and ports mapped to users
const processMap = new Map<string, { process: ChildProcess, port: number }>();

const nextAvailablePort = () => {
    if (!processMap.size) {
        return config.backendPorts.min;
    }

    // Get a map of all the ports in the range currently in use
    let existingPorts = new Map<number, boolean>();
    processMap.forEach(value => {
        existingPorts.set(value.port, true);
    })

    for (let p = config.backendPorts.min; p < config.backendPorts.max; p++) {
        if (!existingPorts.has(p)) {
            return p;
        }
    }
}


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


        // Dummy auth: always accept as long as password matches dummy password
        if (!username || password !== config.dummyPassword) {
            res.status(403).json({success: false, message: "Invalid username/password combo"});
        } else {
            // verify that user exists on the system
            try {
                const uid = userid.uid(username);
                console.log(`Authenticated as user ${username} with uid ${uid}`);
                const token = jwt.sign({
                    username: username,
                    backendSocket: config.backendSocket
                }, privateKey, {algorithm: config.keyAlgorithm, expiresIn: '1h'});
                res.cookie("CARTA-Authorization", token, {maxAge: 1000 * 60 * 60});
                res.json({success: true, message: "Successfully authenticated"});
            } catch (e) {
                res.status(403).json({success: false, message: "Invalid username/password combo"});
            }
        }
    }
    app.post("/api/login", handleLogin);
} else {
    app.post("/api/login", ((req, res) => {
        res.status(400).json({success: false, message: "Login not implemented"});
    }))
}

// This can easily be replaced by another strategy for getting the token from a request
const getTokenFromCookie = (req: express.Request) => {
    return req.cookies?.["CARTA-Authorization"];
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

const handleCheckAuth = (req: AuthenticatedRequest, res: express.Response) => {
    res.json({
        success: true,
        username: req.username,
    });
}

const handleCheckServer = (req: AuthenticatedRequest, res: express.Response) => {
    const existingProcess = processMap.get(req.username);
    if (existingProcess) {
        res.json({
            success: true,
            running: true,
        });
    } else {
        res.json({
            success: true,
            running: false
        });
    }
}

const handleStartServer = async (req: AuthenticatedRequest, res: express.Response) => {
    if (!req.username) {
        res.status(400).json({success: false, message: "Invalid username"});
    }

    // Kill existing backend process for this
    try {
        const existingProcess = processMap.get(req.username);
        if (existingProcess) {
            // Kill the process via the kill script
            spawnSync("sudo", ["-u", `${req.username}`, config.killCommand, `${existingProcess.process.pid}`]);
            // Delay to allow the parent process to exit
            await delay(10);
            processMap.delete(req.username);
        }
    } catch (e) {
        console.log(`Error killing existing process belonging to user ${req.username}`);
        res.status(400).json({success: false, message: "Problem killing existing process"});
        return;
    }

    // Spawn a new process
    try {
        const port = nextAvailablePort();
        const child = spawn("sudo", [
            "-u", `${req.username}`,
            config.processCommand,
            "-port", `${port}`,
            "-root", config.rootFolderTemplate.replace("<username>", req.username),
            "-base", config.baseFolderTemplate.replace("<username>", req.username),
        ]);
        child.stdout.on("data", data => console.log(data.toString()));
        child.on("close", code => {
            console.log(`Process ${child.pid} closed with code ${code} and signal ${child.signalCode}`);
            processMap.delete(req.username);
        });

        // Check for early exit of backend process
        await delay(config.startDelay);
        if (child.exitCode || child.signalCode) {
            res.status(400).json({success: false, message: `Process terminated within ${config.startDelay} ms`});
        } else {
            console.log(`Started process with PID ${child.pid} for user ${req.username} on port ${port}`);
            processMap.set(req.username, {port, process: child});
            res.json({success: true, username: req.username, token: req.jwt});
        }
    } catch (e) {
        console.log(`Error killing existing process belonging to user ${req.username}`);
        res.status(400).json({success: false, message: `Problem starting process for user ${req.username}`});
        return;
    }
}

const handleStopServer = async (req: AuthenticatedRequest, res: express.Response) => {
    // Kill existing backend process for this
    try {
        const existingProcess = processMap.get(req.username);
        if (existingProcess) {
            existingProcess.process.removeAllListeners();
            // Kill the process via the kill script
            spawnSync("sudo", ["-u", `${req.username}`, config.killCommand, `${existingProcess.process.pid}`]);
            // Delay to allow the parent process to exit
            await delay(10);
            console.log(`Process with PID ${existingProcess.process.pid} for user ${req.username} exited via stop request`);
            processMap.delete(req.username);
            res.json({success: true});
        } else {
            res.json({success: false, message: `No existing process belonging to user ${req.username}`});
        }
    } catch (e) {
        console.log(`Error killing existing process belonging to user ${req.username}`);
        res.status(400).json({success: false, message: "Problem killing existing process"});
        return;
    }
}

app.use(express.static('public'))
app.post("/api/startServer", authGuard, handleStartServer);
app.post("/api/stopServer", authGuard, handleStopServer);
app.get("/api/checkAuth", authGuard, handleCheckAuth);
app.get("/api/checkServer", authGuard, handleCheckServer);

const expressServer = app.listen(config.serverPort, () => console.log(`Started listening for login requests on port ${config.serverPort}`));

// Handle WS connections
const backendProxy = httpProxy.createServer({ws: true});
expressServer.on("upgrade", (req, socket, head) => {
    try {
        // Manually fetch and parse cookie, because we're not using express for this route
        const cookieHeader = req.headers?.cookie;
        if (!cookieHeader) {
            socket.end();
            return;
        }
        const cookies = cookie.parse(cookieHeader);
        const tokenCookie = cookies?.["CARTA-Authorization"];

        if (!tokenCookie) {
            socket.end();
            return;
        }

        const token = jwt.verify(tokenCookie, publicKey, {algorithm: config.keyAlgorithm});
        const username = token.username;
        const existingProcess = processMap.get(username);

        if (!existingProcess?.process || existingProcess.process.signalCode) {
            socket.end();
            return;
        }

        if (existingProcess && !existingProcess.process.signalCode) {
            console.log(`Redirecting to backend process for ${username} (port ${existingProcess.port})`);
            backendProxy.ws(req, socket, head, {target: {host: "localhost", port: existingProcess.port}});
            return;
        }
    } catch (err) {
        socket.end();
    }
});