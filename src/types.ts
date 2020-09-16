import * as express from "express";
import {Algorithm} from "jsonwebtoken";

export interface CartaLdapAuthConfig {
    publicKeyLocation: string;
    privateKeyLocation: string;
    keyAlgorithm: Algorithm;
    issuer: string;
    refreshTokenAge: string;
    accessTokenAge: string;
    // Options to pass through to the LDAP Auth instance
    ldapOptions: {
        url: string;
        searchBase: string;
        searchFilter: string;
        starttls: boolean;
        reconnect: boolean;
    }
}

export interface CartaGoogleAuthConfig {
    clientId: string;
    // Valid domain to accept. If this is empty or undefined, all domains are accepted. Domain specified by "hd" field
    validDomain?: string;
    //  Set this to true if you want to lookup users by email address instead of sub
    useEmailAsId: boolean;
    // User lookup table as text file in format <unique user ID> <system user>. If no user lookup is needed, leave this blank
    userLookupTable: string;
}

export interface CartaExternalAuthConfig {
    issuers: string[];
    publicKeyLocation: string;
    keyAlgorithm: string;
    // Unique field to be used as username
    uniqueField: string;
    // User lookup table as text file in format <authenticated username> <system user>. If no user lookup is needed, leave this blank
    userLookupTable?: string;
    // Routes for refreshing access tokens and logging out
    tokenRefreshAddress: string;
    logoutAddress: string;
}

export interface CartaServerConfig {
    // One authProvider must be defined
    authProviders: {
        // LDAP-based username/password authentication and token signing
        ldap?: CartaLdapAuthConfig;
        google?: CartaGoogleAuthConfig;
        external?: CartaExternalAuthConfig;
    };
    database: {
        uri: string;
        databaseName?: string;
    }
    // Port to listen on. It is advised to listen on a port other than 80 or 443, behind an SSL proxy
    serverPort: number;
    // Public-facing server address
    serverAddress: string;
    // If you need to optionally specify a different API or dashboard address
    dashboardAddress: string;
    apiAddress?: string;
    frontendPath: string;
    // Range of ports to user for backend processes. Effectively limits the number of simultaneous users
    backendPorts: {
        min: number;
        max: number;
    }
    processCommand: string;
    // The {username} placeholder will be replaced with the username
    rootFolderTemplate: string;
    baseFolderTemplate: string;
    // {pid} will be replaced by the started process ID
    // {datetime} will be replaced by date and time formatted as "YYYYMMDD.h_mm_ss"
    // Note: if you use /var/log/carta for log files, make sure the user running the server has the appropriate permissions
    logFileTemplate: string;
    // Additional arguments to be passed to the backend process, defined as an array of strings
    additionalArgs: string[];
    killCommand: string;
    // How long to wait before checking whether started process is still running and sending res
    startDelay: number;
    // Dashboard appearance configuration
    dashboard?: {
        // Background color for the dashboard
        backgroundColor: string;
        // Background color for the institutional logo banner
        bannerColor: string;
        // Path to institutional logo in PNG format
        bannerImage?: string;
        // Text displayed before and after sign-in. Plain text or HTML
        infoText?: string;
        // Text displayed before sign-in only. Plain text or HTML
        loginText?: string;
        // Footer text. Plain text or HTML
        footerText?: string;
    }
}


export interface CartaCommandLineOptions {
    [x: string]: unknown;
    config: string;
}

export interface CartaRuntimeConfig {
    dashboardAddress?: string;
    apiAddress?: string;
    googleClientId?: string;
    tokenRefreshAddress?: string;
    logoutAddress?: string;
}

export type RequestHandler = (req: express.Request, res: express.Response) => void;
export type AsyncRequestHandler = (req: express.Request, res: express.Response, next: express.NextFunction) => void;
export type AuthenticatedRequest = express.Request & { username?: string };

// Token verifier function
export type Verifier = (cookieString: string) => any;
// Map for looking up system user name from authenticated user name
export type UserMap = Map<string, string>;