const strippedPath = window.location.href.replace(window.location.search, "").replace("/dashboard", "/");
const apiBase = `${strippedPath}api`;
const urlParams = new URLSearchParams(window.location.search);
let redirectUrl;
let autoRedirect = false;
redirectUrl = `${strippedPath}`;
if (urlParams.has("redirectParams")) {
    redirectUrl+= atob(urlParams.get("redirectParams"));
    autoRedirect = true;
}

const isPopup = urlParams.get("popup");

let serverCheckHandle;

let authenticationType = "";
let authenticatedUser = "";
let token = "";
let tokenLifetime = -1;
let tokenExpiryTime = -1;
let serverRunning = false;
let notyf;

apiCall = async (callName, jsonBody, method, authRequired) => {
    const options = {
        method: method || "get"
    };
    if (jsonBody) {
        options.body = JSON.stringify(jsonBody);
        options.headers = {"Content-Type": "application/json"}
    } else {
        options.headers = {};
    }

    if (token) {
        options.headers["Authorization"] = `Bearer ${token}`;
    }

    const currentTime = Date.now() / 1000;
    // If refresh token expires in under 10 seconds, attempt to refresh before making the call
    if (authRequired && tokenExpiryTime < currentTime + 10) {
        try {
            if (authenticationType === "local") {
                await refreshLocalToken();
            } else if (authenticationType === "google") {
                await refreshGoogleToken();
            }
        } catch (e) {
            console.log(e);
        }
    }
    return fetch(`${apiBase}/${callName}`, options);
}

function setToken(tokenString, expiresIn) {
    token = tokenString;
    tokenLifetime = expiresIn;
    if (isFinite(tokenLifetime) && tokenLifetime > 0) {
        console.log(`Token updated and valid for ${tokenLifetime.toFixed()} seconds`);
        const currentTimeSeconds = Date.now() / 1000;
        tokenExpiryTime = currentTimeSeconds + tokenLifetime;
    } else {
        clearToken();
    }
}

function clearToken() {
    console.log("Clearing token");
    token = undefined;
    tokenLifetime = -1;
}

showMessage = (message, error, elementId) => {
    const statusElement = document.getElementById(elementId || "carta-status");

    if (message) {
        statusElement.style.display = "block";
    } else {
        statusElement.style.display = "none";
        return;
    }

    if (error) {
        statusElement.className = "error-message";
    } else {
        statusElement.className = "success-message";
    }
    statusElement.innerHTML = message;
}

setButtonDisabled = (elementId, disabled) => {
    const button = document.getElementById(elementId);
    if (button) {
        button.disabled = disabled;
        if (disabled) {
            button.classList.add("button-disabled");
        } else {
            button.classList.remove("button-disabled")
        }
    }
}

updateServerStatus = async () => {
    let hasServer = false;
    try {
        const res = await apiCall("server/status", undefined, "get", true);
        if (res.ok) {
            const body = await res.json();
            if (body.success && body.running) {
                hasServer = true;
            }
        } else if (res.status === 403) {
            console.log("Authentication has been lost");
            await handleLogout();
        }
    } catch (e) {
        console.log(e);
    }
    updateRedirectURL(hasServer);
    serverRunning = hasServer;
}

updateRedirectURL = (hasServer) => {
    if (hasServer) {
        showMessage("CARTA server running", false, "carta-status");
    } else {
        showMessage(`Logged in as ${authenticatedUser}`, false, "carta-status");
    }
}

handleLogin = async () => {
    setButtonDisabled("login", true);
    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;
    const body = {username, password};

    try {
        const res = await apiCall("auth/login", body, "post");
        if (res.ok) {
            const body = await res.json();
            setToken(body.access_token, body.expires_in || Number.MAX_VALUE);

            await onLoginSucceeded(username, "local");
        } else {
            onLoginFailed(res.status);
        }
    } catch (e) {
        onLoginFailed(500);
    }
    setButtonDisabled("login", false);
};

onLoginFailed = (status) => {
    clearToken();
    notyf.error(status === 403 ? "Invalid username/password combination" : "Could not authenticate correctly");
}

onLoginSucceeded = async (username, type) => {
    authenticatedUser = username;
    authenticationType = type;
    localStorage.setItem("authenticationType", type);
    notyf.success(`Logged in as ${authenticatedUser}`);
    if (autoRedirect) {
        handleOpenCarta();
    } else {
        showLoginForm(false);
        showCartaForm(true);
        clearInterval(serverCheckHandle);
        serverCheckHandle = setInterval(updateServerStatus, 5000);
        await updateServerStatus();
    }
}

handleServerStop = async () => {
    try {
        try {
            const res = await apiCall("server/stop", undefined, "post", true);
            const body = await res.json();
            if (body.success) {
                notyf.open({type: "info", message: "Stopped CARTA server successfully"});
                await updateServerStatus();
            } else {
                notyf.error("Failed to stop CARTA server");
                console.log(body.message);
            }
        } catch (e) {
            console.log(e);
        }
    } catch (e) {
        notyf.error("Failed to stop CARTA server");
        console.log(e);
    }
}

handleLogout = async () => {
    clearInterval(serverCheckHandle);
    if (authenticationType === "google") {
        await handleGoogleLogout();
    } else {
        await handleLocalLogout();
    }
    if (serverRunning) {
        await handleServerStop();
    }
    showMessage();
    showCartaForm(false);
    showLoginForm(true);
    localStorage.removeItem("authenticationType");
    clearToken();
}

handleOpenCarta = () => {
    window.open(redirectUrl, "_self");
}

initGoogleAuth = () => {
    gapi.load("auth2", function () {
        console.log("Google auth loaded");
        gapi.auth2.init();
    });
};

onSignIn = (googleUser) => {
    const profile = googleUser.getBasicProfile();
    const authResponse = googleUser.getAuthResponse();
    setToken(authResponse.id_token, authResponse.expires_in);
    onLoginSucceeded(profile.getEmail(), "google");
}

handleGoogleLogout = async () => {
    try {
        if (gapi && gapi.auth2) {
            const authInstance = gapi.auth2.getAuthInstance();
            if (authInstance) {
                await authInstance.disconnect();
            }
        }
    } catch (err) {
        notyf.error("Error signing out of Google");
        console.log(err);
    }
}

handleLocalLogout = async () => {
    await apiCall("auth/logout", undefined, "post", false);
}

refreshGoogleToken = async () => {
    try {
        if (gapi && gapi.auth2) {
            const authInstance = gapi.auth2.getAuthInstance();
            if (authInstance && authInstance.currentUser) {
                const user = authInstance.currentUser.get();
                if (user) {
                    const authResponse = await user.reloadAuthResponse();
                    if (authResponse && authResponse.id_token) {
                        setToken(authResponse.id_token, authResponse.expires_in);
                    }
                }
            }
        }
    } catch (err) {
        notyf.error("Error refreshing Google login");
        console.log(err);
    }
}

refreshLocalToken = async () => {
    try {
        const res = await apiCall("auth/refresh", {}, "post");
        if (res.ok) {
            const body = await res.json();
            if (body.access_token) {
                setToken(body.access_token, body.expires_in || Number.MAX_VALUE);
            }
        }
    } catch (err) {
        notyf.error("Error refreshing authentication");
        console.log(err);
    }
}

showCartaForm = (show) => {
    const cartaForm = document.getElementsByClassName("carta-form")[0];
    if (show) {
        cartaForm.style.display = "block";
    } else {
        cartaForm.style.display = "none";

    }
}

showLoginForm = (show) => {
    const loginForm = document.getElementsByClassName("login-form")[0];
    if (show) {
        loginForm.style.display = "block";
    } else {
        loginForm.style.display = "none";

    }
}

window.onload = async () => {
    notyf = new Notyf({
        ripple: true,
        position: {x: "center"},
        types: [{
            type: "warning",
            background: "orange"
        }, {
            type: "info",
            background: "#4c84af",
        }]
    });

    // Hide open button if using popup
    if (isPopup) {
        document.getElementById("open").style.display = "none";
    }
    const existingLoginType = localStorage.getItem("authenticationType");
    if (existingLoginType === "local") {
        try {
            const res = await apiCall("auth/refresh", {}, "post");
            if (res.ok) {
                const body = await res.json();
                if (body.access_token) {
                    setToken(body.access_token, body.expires_in || Number.MAX_VALUE);
                    await onLoginSucceeded(body.username, "local");
                } else {
                    await handleLogout();
                }
            }
        } catch (e) {
            console.log(e);
        }
    }

    // Wire up buttons
    const loginButton = document.getElementById("login");
    if (loginButton) {
        loginButton.onclick = handleLogin;
    }

    document.getElementById("stop").onclick = handleServerStop;
    document.getElementById("open").onclick = handleOpenCarta;
    document.getElementById("logout").onclick = handleLogout;
}
