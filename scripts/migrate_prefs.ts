import {Collection, Db, MongoClient} from "mongodb";
import * as _ from "lodash";
import {ServerConfig} from "../src/config";

let client: MongoClient;
let preferenceMap = new Map<string, any>();

export enum PreferenceKeys {
    GLOBAL_THEME = "theme",
    GLOBAL_AUTOLAUNCH = "autoLaunch",
    GLOBAL_LAYOUT = "layout",
    GLOBAL_CURSOR_POSITION = "cursorPosition",
    GLOBAL_ZOOM_MODE = "zoomMode",
    GLOBAL_ZOOM_POINT = "zoomPoint",
    GLOBAL_DRAG_PANNING = "dragPanning",
    GLOBAL_SPECTRAL_MATCHING_TYPE = "spectralMatchingType",
    GLOBAL_AUTO_WCS_MATCHING = "autoWCSMatching",

    RENDER_CONFIG_SCALING = "scaling",
    RENDER_CONFIG_COLORMAP = "colormap",
    RENDER_CONFIG_PERCENTILE = "percentile",
    RENDER_CONFIG_SCALING_ALPHA = "scalingAlpha",
    RENDER_CONFIG_SCALING_GAMMA = "scalingGamma",
    RENDER_CONFIG_NAN_COLOR_HEX = "nanColorHex",
    RENDER_CONFIG_NAN_ALPHA = "nanAlpha",

    CONTOUR_CONFIG_CONTOUR_GENERATOR_TYPE = "contourGeneratorType",
    CONTOUR_CONFIG_CONTOUR_SMOOTHING_MODE = "contourSmoothingMode",
    CONTOUR_CONFIG_CONTOUR_SMOOTHING_FACTOR = "contourSmoothingFactor",
    CONTOUR_CONFIG_CONTOUR_NUM_LEVELS = "contourNumLevels",
    CONTOUR_CONFIG_CONTOUR_THICKNESS = "contourThickness",
    CONTOUR_CONFIG_CONTOUR_COLORMAP_ENABLED = "contourColormapEnabled",
    CONTOUR_CONFIG_CONTOUR_COLOR = "contourColor",
    CONTOUR_CONFIG_CONTOUR_COLORMAP = "contourColormap",

    WCS_OVERLAY_AST_COLOR = "astColor",
    WCS_OVERLAY_AST_GRID_VISIBLE = "astGridVisible",
    WCS_OVERLAY_AST_LABELS_VISIBLE = "astLabelsVisible",
    WCS_OVERLAY_WCS_TYPE = "wcsType",
    WCS_OVERLAY_BEAM_VISIBLE = "beamVisible",
    WCS_OVERLAY_BEAM_COLOR = "beamColor",
    WCS_OVERLAY_BEAM_TYPE = "beamType",
    WCS_OVERLAY_BEAM_WIDTH = "beamWidth",

    REGION_COLOR = "regionColor",
    REGION_LINE_WIDTH = "regionLineWidth",
    REGION_DASH_LENGTH = "regionDashLength",
    REGION_TYPE = "regionType",
    REGION_CREATION_MODE = "regionCreationMode",

    PERFORMANCE_IMAGE_COMPRESSION_QUALITY = "imageCompressionQuality",
    PERFORMANCE_ANIMATION_COMPRESSION_QUALITY = "animationCompressionQuality",
    PERFORMANCE_GPU_TILE_CACHE = "GPUTileCache",
    PERFORMANCE_SYSTEM_TILE_CACHE = "systemTileCache",
    PERFORMANCE_CONTOUR_DECIMATION = "contourDecimation",
    PERFORMANCE_CONTOUR_COMPRESSION_LEVEL = "contourCompressionLevel",
    PERFORMANCE_CONTOUR_CHUNK_SIZE = "contourChunkSize",
    PERFORMANCE_CONTOUR_CONTROL_MAP_WIDTH = "contourControlMapWidth",
    PERFORMANCE_STREAM_CONTOURS_WHILE_ZOOMING = "streamContoursWhileZooming",
    PERFORMANCE_LOW_BAND_WIDTH_MODE = "lowBandwidthMode",
    PERFORMANCE_STOP_ANIMATION_PLAYBACK_MINUTES = "stopAnimationPlaybackMinutes",

    LOG_EVENT = "logEventList"
}

async function updateUsernameIndex(collection: Collection, unique: boolean) {
    const hasIndex = await collection.indexExists("username");
    if (!hasIndex) {
        await collection.createIndex({username: 1}, {name: "username", unique, dropDups: unique});
        console.log(`Created username index for collection ${collection.collectionName}`);
    }
}

async function createOrGetCollection(db: Db, collectionName: string) {
    const collectionExists = await db.listCollections({name: collectionName}, {nameOnly: true}).hasNext();
    if (collectionExists) {
        return db.collection(collectionName);
    } else {
        console.log(`Creating collection ${collectionName}`);
        return db.createCollection(collectionName);
    }
}

function findDeep(obj: any, pred: (obj: any) => boolean): any {
    if (pred(obj)) {
        return [obj];
    }
    return _.flatten(_.map(obj, child => {
        return typeof child === "object" ? findDeep(child, pred) : [];
    }));
}

function upgradeLayout(layout: { layoutVersion: 1 | 2, docked: any, floating: any }) {
    // Upgrade to V2 if required
    if (layout.layoutVersion === 1) {
        const spatialProfileWidgets = findDeep(layout, item => item.id === "spatial-profiler");
        for (const widget of spatialProfileWidgets) {
            if (widget.coord) {
                if (!widget.widgetSettings) {
                    widget.widgetSettings = {};
                }
                widget.widgetSettings.coordinate = widget.coord;
                delete widget.coord;
            }
        }
        layout.layoutVersion = 2;
    }

    // Upgrade floating widgets to consistent type
    if (layout.floating && Array.isArray(layout.floating)) {
        for (const widget of layout.floating) {
            if (widget.type !== "component") {
                // Store widget type as id, to be consistent with docked widgets
                widget.id = widget.type;
                widget.type = "component";
            }
        }
    }
}

function upgradePreferenceObject(preferenceObject: any) {
    // Strings
    const stringKeys = [
        PreferenceKeys.GLOBAL_THEME, PreferenceKeys.GLOBAL_LAYOUT, PreferenceKeys.GLOBAL_CURSOR_POSITION, PreferenceKeys.GLOBAL_ZOOM_MODE,
        PreferenceKeys.GLOBAL_ZOOM_POINT, PreferenceKeys.GLOBAL_SPECTRAL_MATCHING_TYPE, PreferenceKeys.RENDER_CONFIG_COLORMAP, PreferenceKeys.RENDER_CONFIG_NAN_COLOR_HEX,
        PreferenceKeys.CONTOUR_CONFIG_CONTOUR_GENERATOR_TYPE, PreferenceKeys.CONTOUR_CONFIG_CONTOUR_COLOR, PreferenceKeys.CONTOUR_CONFIG_CONTOUR_COLORMAP,
        PreferenceKeys.WCS_OVERLAY_WCS_TYPE, PreferenceKeys.WCS_OVERLAY_BEAM_COLOR, PreferenceKeys.WCS_OVERLAY_BEAM_TYPE, PreferenceKeys.REGION_COLOR,
        PreferenceKeys.REGION_CREATION_MODE
    ];

    const intKeys = [
        PreferenceKeys.GLOBAL_AUTO_WCS_MATCHING, PreferenceKeys.RENDER_CONFIG_SCALING, PreferenceKeys.CONTOUR_CONFIG_CONTOUR_SMOOTHING_MODE,
        PreferenceKeys.CONTOUR_CONFIG_CONTOUR_SMOOTHING_FACTOR, PreferenceKeys.CONTOUR_CONFIG_CONTOUR_NUM_LEVELS, PreferenceKeys.WCS_OVERLAY_AST_COLOR,
        PreferenceKeys.REGION_DASH_LENGTH, PreferenceKeys.REGION_TYPE, PreferenceKeys.PERFORMANCE_IMAGE_COMPRESSION_QUALITY, PreferenceKeys.PERFORMANCE_ANIMATION_COMPRESSION_QUALITY,
        PreferenceKeys.PERFORMANCE_GPU_TILE_CACHE, PreferenceKeys.PERFORMANCE_SYSTEM_TILE_CACHE, PreferenceKeys.PERFORMANCE_CONTOUR_DECIMATION,
        PreferenceKeys.PERFORMANCE_CONTOUR_COMPRESSION_LEVEL, PreferenceKeys.PERFORMANCE_CONTOUR_CHUNK_SIZE, PreferenceKeys.PERFORMANCE_CONTOUR_CONTROL_MAP_WIDTH,
        PreferenceKeys.PERFORMANCE_STOP_ANIMATION_PLAYBACK_MINUTES
    ];

    const numberKeys = [
        PreferenceKeys.RENDER_CONFIG_PERCENTILE, PreferenceKeys.RENDER_CONFIG_SCALING_ALPHA, PreferenceKeys.RENDER_CONFIG_SCALING_GAMMA,
        PreferenceKeys.RENDER_CONFIG_NAN_ALPHA, PreferenceKeys.CONTOUR_CONFIG_CONTOUR_THICKNESS, PreferenceKeys.WCS_OVERLAY_BEAM_WIDTH,
        PreferenceKeys.REGION_LINE_WIDTH,
    ];

    const booleanKeys = [
        PreferenceKeys.GLOBAL_AUTOLAUNCH, PreferenceKeys.GLOBAL_DRAG_PANNING, PreferenceKeys.CONTOUR_CONFIG_CONTOUR_COLORMAP_ENABLED,
        PreferenceKeys.WCS_OVERLAY_AST_GRID_VISIBLE, PreferenceKeys.WCS_OVERLAY_AST_LABELS_VISIBLE, PreferenceKeys.WCS_OVERLAY_BEAM_VISIBLE,
        PreferenceKeys.PERFORMANCE_STREAM_CONTOURS_WHILE_ZOOMING, PreferenceKeys.PERFORMANCE_LOW_BAND_WIDTH_MODE
    ];

    for (const key of intKeys) {
        const entry = parseInt(preferenceObject[key]);
        if (isFinite(entry)) {
            preferenceObject[key] = entry;
        }
    }

    for (const key of numberKeys) {
        const entry = parseFloat(preferenceObject[key]);
        if (isFinite(entry)) {
            preferenceObject[key] = entry;
        }
    }

    for (const key of booleanKeys) {
        const entryString = preferenceObject[key];
        if (entryString) {
            preferenceObject[key] = preferenceObject[key] === "true";
        }
    }

    const logEntryString = preferenceObject[PreferenceKeys.LOG_EVENT];
    if (logEntryString) {
        try {
            const logEntries = JSON.parse(logEntryString);
            if (logEntries && Array.isArray(logEntries) && logEntries.length) {
                preferenceObject[PreferenceKeys.LOG_EVENT] = logEntries;
            } else {
                delete preferenceObject[PreferenceKeys.LOG_EVENT];
            }
        } catch (e) {
            console.log("Problem parsing log events");
        }
    }

    // Manual schema adjustments

    // Beam -> beam and Solid -> solid
    if (preferenceObject[PreferenceKeys.WCS_OVERLAY_BEAM_TYPE]) {
        preferenceObject[PreferenceKeys.WCS_OVERLAY_BEAM_TYPE] = preferenceObject[PreferenceKeys.WCS_OVERLAY_BEAM_TYPE].toLowerCase();
    }

    // 1.0x to full
    if (preferenceObject[PreferenceKeys.GLOBAL_ZOOM_MODE] === "1.0x") {
        preferenceObject[PreferenceKeys.GLOBAL_ZOOM_MODE] = "full";
    }

    preferenceObject["version"] = 1;
}

async function upgradePreferences() {
    client = await MongoClient.connect(ServerConfig.database.uri, {useUnifiedTopology: true});
    const db = await client.db(ServerConfig.database.databaseName);
    const oldPreferences = await db.collection("preferences_old");

    const preferenceCollection = await createOrGetCollection(db, "preferences");
    // Remove any existing validation in preferences collection
    await db.command({collMod: "preferences", validator: {}, validationLevel: "off"});
    // Update collection indices if necessary
    await updateUsernameIndex(preferenceCollection, true);

    const docs = await oldPreferences.find({}, {projection: {_id: 0}}).toArray();
    for (const doc of docs) {
        const username = doc.username;
        let preferenceObject = preferenceMap.get(username) ?? {};
        for (const key in doc) {
            preferenceObject[key] = doc[key];
        }
        preferenceMap.set(username, preferenceObject);
    }
    for (let [username, preferenceObject] of preferenceMap) {
        upgradePreferenceObject(preferenceObject);
        try {
            const result = await preferenceCollection.insertOne(preferenceObject);
            if (result?.insertedCount) {
                console.log(`Updated preferences for ${username}`);
            }
        } catch (e) {
            console.log(e);
        }
    }
}

async function upgradeLayouts() {
    client = await MongoClient.connect(ServerConfig.database.uri, {useUnifiedTopology: true});
    const db = await client.db(ServerConfig.database.databaseName);
    const oldLayouts = await db.collection("layouts_old");

    const layoutsCollection = await createOrGetCollection(db, "layouts");
    // Update collection indices if necessary
    await updateUsernameIndex(layoutsCollection, false);

    const docs = await oldLayouts.find({}, {projection: {_id: 0}}).toArray();
    for (const doc of docs) {
        if (!doc.username || !doc.name || !doc.json_string) {
            continue;
        }
        try {
            const layout = JSON.parse(doc.json_string);
            const result = await layoutsCollection.insertOne({
                name: doc.name,
                username: doc.username,
                layout
            });
            if (result?.insertedCount) {
                console.log(`Updated layout ${doc.name} for ${doc.username}`);
            }
        } catch (e) {
            console.log(e);
        }
    }
}

upgradePreferences().then(() => {
    upgradeLayouts().then(() => {
        process.exit(0);
    })
});