const apiBase = `${window.location.origin}/api`;

let port = -1;
let serverCheckHandle;

const apiCall = (callName, jsonBody, method) => {
    const options = {
        method: method || "get"
    };
    if (jsonBody) {
        options.body = JSON.stringify(jsonBody);
        options.headers = {'Content-Type': 'application/json'}
    }
    return fetch(`${apiBase}/${callName}`, options);
}


const showMessage = (message, error, elementId) => {
    const statusElement = document.getElementById(elementId || "login-status");

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

const setButtonDisabled = (elementId, disabled) => {
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

window.onload = async () => {
    if (document.cookie.includes("CARTA-Authorization")) {
        try {
            const res = await apiCall("checkAuth");
            if (res.ok) {
                const body = await res.json();
                if (body.success && body.username) {
                    onLoginSucceeded(body.username);
                }
            }
        } catch (e) {
            console.log(e);
        }
    }
}

const updateServerStatus = async () => {
    let serverPort = -1;
    try {
        const res = await apiCall("checkServer");
        if (res.ok) {
            const body = await res.json();
            if (body.success && body.port) {
                serverPort = body.port;
            }
        }
    } catch (e) {
        console.log(e);
    }
    updateRedirectURL(serverPort);
}

const updateRedirectURL = (p) => {
    port = p;
    if (port > 0) {
        setButtonDisabled("start", true);
        setButtonDisabled("stop", false);

        let redirectUrl = `${window.location.origin}/frontend?socketUrl=ws://${window.location.host}`;
        // update port:
        redirectUrl = redirectUrl.replace(/:(\d+)$/, `:${port}`);
        console.log(redirectUrl);

        const title = `CARTA server running on port ${port}`;
        showMessage(title.link(redirectUrl), false, "carta-status");

    } else {
        setButtonDisabled("stop", true);
        setButtonDisabled("start", false);
        showMessage(`No CARTA server running`, false, "carta-status");
    }
}

document.getElementById("login").onclick = async () => {
    setButtonDisabled("login", true);
    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;
    const body = {username, password};

    try {
        const res = await apiCall("login", body, "post");
        if (res.ok) {
            onLoginSucceeded(username);
        } else {
            onLoginFailed(res.status);
        }
    } catch (e) {
        onLoginFailed(500);
    }
    setButtonDisabled("login", false);
}

onLoginFailed = (status) => {
    showMessage(status === 403 ? "Invalid username/password combination" : "Could not authenticate correctly", true);
}

onLoginSucceeded = async (username) => {
    showMessage("");
    await updateServerStatus();
    showLoginForm(false);
    showCartaForm(true);
    serverCheckHandle = setInterval(updateServerStatus, 2000);
}

document.getElementById("start").onclick = async () => {
    setButtonDisabled("start", true);
    setButtonDisabled("stop", true);
    try {
        try {
            const res = await apiCall("startServer", undefined, "post");
            const body = await res.json();
            if (body.success) {
                // Handle CARTA server redirect
                console.log(`Redirecting to CARTA frontend with socket ${body.port} as user ${body.username}`);
            } else {
                showMessage("Failed to start CARTA server", true);
                console.log(body.message);
            }
        } catch (e) {
            console.log(e);
        }
    } catch (e) {
        showMessage("Failed to start CARTA server", true);
    }
    await updateServerStatus();
}
const handleServerStop = async () => {
    setButtonDisabled("start", true);
    setButtonDisabled("stop", true);
    try {
        try {
            const res = await apiCall("stopServer", undefined, "post");
            const body = await res.json();
            if (body.success) {
                // Handle CARTA server redirect
                console.log(`Stopped server successfully`);
            } else {
                showMessage("Failed to stop CARTA server", true);
                console.log(body.message);
            }

        } catch (e) {
            console.log(e);
        }
    } catch (e) {
        showMessage("Failed to start CARTA server", true);
    }
    await updateServerStatus();
}

document.getElementById("stop").onclick = handleServerStop;

document.getElementById("logout").onclick = async () => {
    await handleServerStop();
    clearInterval(serverCheckHandle);
    showMessage();
    showCartaForm(false);
    showLoginForm(true);
    // Remove cookie
    document.cookie = "CARTA-Authorization=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
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