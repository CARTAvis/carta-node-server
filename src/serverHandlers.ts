import * as express from "express";
import * as httpProxy from "http-proxy";
import * as url from "url";
import * as querystring from "querystring";

import {ChildProcess, spawn, spawnSync} from "child_process";
import {delay, noCache} from "./util";
import {AuthenticatedRequest, authGuard, getUser, verifyToken} from "./auth";
import {IncomingMessage} from "http";

const config = require("../config/config.ts");
const processMap = new Map<string, { process: ChildProcess, port: number }>();

function nextAvailablePort() {
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
    return -1;
}

function handleCheckServer(req: AuthenticatedRequest, res: express.Response) {
    if (!req.username) {
        res.status(403).json({success: false, message: "Invalid username"});
        return;
    }

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

async function handleStartServer(req: AuthenticatedRequest, res: express.Response) {
    const username = req.username;
    const forceRestart = req.body?.forceRestart;
    if (!username) {
        res.status(403).json({success: false, message: "Invalid username"});
        return;
    }

    const existingProcess = processMap.get(username);

    if (existingProcess) {
        if (forceRestart) {
            // Kill existing backend process for this
            try {
                const existingProcess = processMap.get(username);
                if (existingProcess) {
                    // Kill the process via the kill script
                    spawnSync("sudo", ["-u", `${username}`, config.killCommand, `${existingProcess.process.pid}`]);
                    // Delay to allow the parent process to exit
                    await delay(10);
                    processMap.delete(username);
                }
            } catch (e) {
                console.log(`Error killing existing process belonging to user ${username}`);
                throw {statusCode: 400, message: "Problem killing existing process"};
            }
        } else {
            return res.json({success: true});
        }
    } else {
        try {
            await startServer(username);
            return res.json({success: true});
        } catch (e) {
            throw e;
        }
    }
}

async function startServer(username: string) {
    // Spawn a new process
    try {
        const port = nextAvailablePort();
        if (port < 0) {
            throw {statusCode: 500, message: "No available ports for the backend process"};
        }

        let args = [
            "-u", `${username}`,
            config.processCommand,
            "-port", `${port}`,
            "-root", config.rootFolderTemplate.replace("<username>", username),
            "-base", config.baseFolderTemplate.replace("<username>", username),
        ];

        if (config.additionalArgs) {
            args = args.concat(config.additionalArgs);
        }

        const child = spawn("sudo", args);
        child.stdout.on("data", data => console.log(data.toString()));
        child.on("close", code => {
            console.log(`Process ${child.pid} closed with code ${code} and signal ${child.signalCode}`);
            processMap.delete(username);
        });

        // Check for early exit of backend process
        await delay(config.startDelay);
        if (child.exitCode || child.signalCode) {
            throw {statusCode: 500, message: `Problem starting process for user ${username}`};
        } else {
            console.log(`Started process with PID ${child.pid} for user ${username} on port ${port}`);
            processMap.set(username, {port, process: child});
            return;
        }
    } catch (e) {
        console.log(`Error killing existing process belonging to user ${username}`);
        if (e.statusCode && e.message) {
            throw e;
        } else {
            throw {statusCode: 500, message: "Problem starting process for user ${username}"};
        }
    }
}

async function handleStopServer(req: AuthenticatedRequest, res: express.Response) {
    if (!req.username) {
        res.status(403).json({success: false, message: "Invalid username"});
        return;
    }

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
            res.status(400).json({success: false, message: `No existing process belonging to user ${req.username}`});
        }
    } catch (e) {
        console.log(`Error killing existing process belonging to user ${req.username}`);
        res.status(500).json({success: false, message: "Problem killing existing process"});
    }
}

export const createUpgradeHandler = (server: httpProxy) => async (req: IncomingMessage, socket: any, head: any) => {
    try {
        if (!req?.url) {
            return socket.end();
        }
        let parsedUrl = url.parse(req.url);
        if (!parsedUrl?.query) {
            return socket.end();
        }
        let queryParameters = querystring.parse(parsedUrl.query);
        const tokenString = queryParameters?.token;
        if (!tokenString || Array.isArray(tokenString)) {
            return socket.end();
        }

        console.log(`WS upgrade with token="${tokenString}" as query parameter`);
        const token = await verifyToken(tokenString);
        if (!token || !token.username) {
            return socket.end();
        }
        const username = getUser(token.username, token.iss);
        if (!username) {
            return socket.end();
        }
        let existingProcess = processMap.get(username);

        if (!existingProcess?.process || existingProcess.process.signalCode) {
            // Attempt to start new process
            existingProcess?.process?.removeAllListeners();
            await startServer(username);
            existingProcess = processMap.get(username);
        }

        if (existingProcess && !existingProcess.process.signalCode) {
            console.log(`Redirecting to backend process for ${username} (port ${existingProcess.port})`);
            return server.ws(req, socket, head, {target: {host: "localhost", port: existingProcess.port}});
        }
    } catch (err) {
        return socket.end();
    }
}

export const serverRouter = express.Router();
serverRouter.post("/start", authGuard, noCache, handleStartServer);
serverRouter.post("/stop", authGuard, noCache, handleStopServer);
serverRouter.get("/status", authGuard, noCache, handleCheckServer);

