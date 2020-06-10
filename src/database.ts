import * as express from "express";
import {Collection, MongoClient} from "mongodb";
import {AuthenticatedRequest, authGuard} from "./auth";

const preferenceSchema = require("./preference_schema.json");
const config = require("../config/config.ts");

let client: MongoClient;
let preferenceCollection: Collection;

export async function initDB() {
    if (config.database?.url && config.database?.databaseName) {
        try {
            client = await MongoClient.connect(config.database.url, {useUnifiedTopology: true});
            const db = await client.db(config.database.databaseName);
            // Create collection if it doesn't exist
            preferenceCollection = await db.createCollection("preferences");
            // Update with the latest schema
            await db.command({collMod: "preferences", validator: {$jsonSchema: preferenceSchema}});
            const hasIndex = await preferenceCollection.indexExists("username");
            if (!hasIndex) {
                await preferenceCollection.createIndex({username: 1}, {name: "username", unique: true, dropDups: true});
                console.log(`Created username index for collection ${preferenceCollection.collectionName}`);
            }
            console.log(`Connected to server ${config.database.url} and database ${config.database.databaseName}`);
        } catch (err) {
            console.log(err);
            console.error("Error connecting to database");
        }
    }
}

async function handleGetPreferences(req: AuthenticatedRequest, res: express.Response) {
    if (!req.username) {
        res.status(403).json({success: false, message: "Invalid username"});
        return;
    }

    if (!preferenceCollection) {
        res.status(501).json({success: false, message: "Database not configured"});
        return;
    }

    try {
        const doc = await preferenceCollection.findOne({username: req.username}, {projection: {_id: 0, username: 0}});
        if (doc) {
            res.json({success: true, preferences: doc});
        } else {
            res.status(500).json({success: false, message: "Problem retrieving preferences"});
        }
    } catch (err) {
        console.log(err);
        res.status(500).json({success: false, message: "Problem retrieving preferences"});
        return;
    }
}

async function handleSetPreference(req: AuthenticatedRequest, res: express.Response) {
    if (!req.username) {
        res.status(403).json({success: false, message: "Invalid username"});
        return;
    }

    if (!preferenceCollection) {
        res.status(501).json({success: false, message: "Database not configured"});
        return;
    }

    const update = req.body;
    // Check for malformed update
    if (!update || !Object.keys(update).length || update.username || update._id) {
        res.status(400).json({success: false, message: "Malformed preference update"});
        return;
    }

    try {
        const updateResult = await preferenceCollection.updateOne({username: req.username}, {$set: update}, {upsert: true});
        if (updateResult.result?.ok) {
            res.json({success: true});
        } else {
            res.status(500).json({success: false, message: "Problem updating preferences"});
        }
    } catch (err) {
        console.log(err.errmsg);
        res.status(500).json({success: false, message: err.errmsg});
        return;
    }
}

async function handleClearPreferences(req: AuthenticatedRequest, res: express.Response) {
    if (!req.username) {
        res.status(403).json({success: false, message: "Invalid username"});
        return;
    }

    if (!preferenceCollection) {
        res.status(501).json({success: false, message: "Database not configured"});
        return;
    }

    const keys: string[] = req.body?.keys;
    // Check for malformed update
    if (!keys || !Array.isArray(keys) || !keys.length) {
        res.status(400).json({success: false, message: "Malformed list of keys"});
        return;
    }

    const update: any = {};
    for (const key of keys) {
        update[key] = "";
    }

    try {
        const updateResult = await preferenceCollection.updateOne({username: req.username}, {$unset: update});
        if (updateResult.result?.ok) {
            res.json({success: true});
        } else {
            res.status(500).json({success: false, message: "Problem clearing preferences"});
        }
    } catch (err) {
        console.log(err);
        res.status(500).json({success: false, message: "Problem clearing preferences"});
        return;
    }
}

export const databaseRouter = express.Router();

databaseRouter.get("/preferences", authGuard, handleGetPreferences);
databaseRouter.delete("/preferences", authGuard, handleClearPreferences);
databaseRouter.put("/preference", authGuard, handleSetPreference);