// --- ১. টেলিগ্রাম বট দিয়ে অ্যালার্ট ও জিপিএস লোকেশন পাঠানোর সেটআপ ---
const TELEGRAM_BOT_TOKEN = "8795724835:AAE-xYFohqnPckaSKdrMygLBiruFJMN3Eow";
const TELEGRAM_CHAT_ID = "5199115006";

function sendTelegramAlert(baseMessage) {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const lat = position.coords.latitude;
                const lon = position.coords.longitude;
                const googleMapsLink = `https://www.google.com/maps?q=${lat},${lon}`;
                const fullMessage = `${baseMessage}\n📍 Location: ${googleMapsLink}`;
                
                sendTelegramMessage(fullMessage);
            },
            (error) => {
                console.log("Location access denied.");
                const fallbackMessage = `${baseMessage}\n📍 Location: Unavailable (Permission Denied)`;
                sendTelegramMessage(fallbackMessage);
            }
        );
    } else {
        sendTelegramMessage(baseMessage);
    }
}

function sendTelegramMessage(text) {
    // ব্রাউজার সিকিউরিটি (CORS) এড়াতে GET রিকোয়েস্ট ব্যবহার করা হলো
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage?chat_id=${TELEGRAM_CHAT_ID}&text=${encodeURIComponent(text)}`;
    
    fetch(url)
    .then(response => console.log("Telegram Alert Sent Successfully!"))
    .catch(error => console.error("Telegram Failed:", error));
}

// --- ২. ফেস আইডি (WebAuthn) সিকিউরিটি ---
document.getElementById('unlockBtn').addEventListener('click', async () => {
    try {
        const publicKey = {
            challenge: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
            rp: { name: "Smart Car System" },
            user: {
                id: new Uint8Array([1, 2, 3, 4]),
                name: "owner",
                displayName: "Car Owner"
            },
            pubKeyCredParams: [{ type: "public-key", alg: -7 }],
            authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
            timeout: 60000
        };
        await navigator.credentials.create({ publicKey });
        
        document.getElementById('lockScreen').style.display = 'none'; 
    } catch (err) {
        console.error("Face ID Error:", err);
        alert("Authentication Failed! ❌ Only the owner can unlock.");
    }
});

// --- ৩. ব্লুটুথ (BLE) সেটআপ ---
const SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const RX_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"; 
const TX_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"; 

let rxCharacteristic = null;
let isConnected = false;
let lastCommand = "";

const statusDiv = document.getElementById('status');
const connectBtn = document.getElementById('connectBtn');

connectBtn.addEventListener('click', async () => {
    try {
        statusDiv.innerText = "Status: Scanning...";
        statusDiv.style.color = "#ffff00";

        const device = await navigator.bluetooth.requestDevice({
            filters: [{ name: 'ESP32_SmartCar' }],
            optionalServices: [SERVICE_UUID]
        });

        // গাড়ি অফ/ডিসকানেক্ট হলে
        device.addEventListener('gattserverdisconnected', () => {
            isConnected = false;
            statusDiv.innerText = "Status: Disconnected!";
            statusDiv.style.color = "#ff4d4d";
            connectBtn.innerText = "Reconnect";
            sendTelegramAlert("⚠️ Alert: Robot Car has been Disconnected or Powered OFF!");
        });

        const server = await device.gatt.connect();
        const service = await server.getPrimaryService(SERVICE_UUID);
        
        rxCharacteristic = await service.getCharacteristic(RX_UUID);
        const txCharacteristic = await service.getCharacteristic(TX_UUID);

        // গাড়ি আটকে গেলে (STUCK)
        await txCharacteristic.startNotifications();
        txCharacteristic.addEventListener('characteristicvaluechanged', (e) => {
            const value = new TextDecoder().decode(e.target.value);
            if (value === "STUCK") {
                sendTelegramAlert("⚠️ Emergency: Robot Car is STUCK! Need Help!");
            }
        });

        isConnected = true;
        statusDiv.innerText = "Status: Connected 🟢";
        statusDiv.style.color = "#00ffcc";
        connectBtn.innerText = "Connected";

    } catch (error) {
        console.log(error);
        statusDiv.innerText = "Status: Connection Failed!";
        statusDiv.style.color = "#ff4d4d";
    }
});

async function sendCommand(cmd, force = false) {
    if (!isConnected || !rxCharacteristic) return;
    // মুভমেন্ট কমান্ড (F/B/L/R/S) সবসময় ফোর্স করে পাঠানো হয়,
    // কারণ ESP32 তে গাড়ি বাধার (obstacle) কারণে F_BLOCKED/B_BLOCKED
    // অবস্থায় আটকে গেলে, একই "F"/"B" কমান্ড আবার পাঠালেই সেটা রিকভার হয়।
    // dedup চেক থাকলে পুনরায় একই বাটনে চাপ দিলে কমান্ড আসলে পাঠানোই হতো না।
    if (!force && cmd === lastCommand) return; 
    try {
        const encoder = new TextEncoder();
        await rxCharacteristic.writeValue(encoder.encode(cmd));
        lastCommand = cmd;
        console.log("[BLE SENT] cmd =", cmd, "| force =", force); // টেস্টিং এর জন্য
    } catch (error) {
        console.log("Send Error:", error);
    }
}

// --- ৪. ম্যানুয়াল কন্ট্রোল বাটন লজিক ---
const bindButton = (id, cmd) => {
    const btn = document.getElementById(id);
    if(btn) {
        // force = true, যাতে বাধা কেটে যাওয়ার পর একই বাটনে আবার চাপ দিলেও
        // কমান্ড ESP32 তে পৌঁছায় এবং গাড়ি আবার চলা শুরু করে
        btn.addEventListener('mousedown', () => sendCommand(cmd, true));
        btn.addEventListener('touchstart', (e) => { e.preventDefault(); sendCommand(cmd, true); });
    }
};

bindButton('btnF', 'F');
bindButton('btnB', 'B');
bindButton('btnL', 'L');
bindButton('btnR', 'R');
bindButton('btnS', 'S');

const btnLightOn = document.getElementById('btnLightOn');
if(btnLightOn) {
    btnLightOn.onclick = () => {
        document.getElementById('lightSlider').value = 255;
        document.getElementById('sliderValue').innerText = 255;
        sendCommand("255");
    };
}

const btnLightOff = document.getElementById('btnLightOff');
if(btnLightOff) {
    btnLightOff.onclick = () => {
        document.getElementById('lightSlider').value = 0;
        document.getElementById('sliderValue').innerText = 0;
        sendCommand("0");
    };
}

const lightSlider = document.getElementById('lightSlider');
if(lightSlider) {
    lightSlider.oninput = (e) => {
        const val = e.target.value;
        document.getElementById('sliderValue').innerText = val;
        sendCommand(val);
    };
}

// --- ৫. ক্যামেরা এবং MediaPipe জেসচার লজিক (Python কোডের এক্সাক্ট লজিক অনুযায়ী) ---

// থাম্ব (৪) ও ইনডেক্স টিপ (৮) এর মধ্যে দূরত্ব থেকে 0-255 ব্রাইটনেস ভ্যালু বের করা
// (MIN_DIST, MAX_DIST — Python কোডের মতোই একই মান)
function getDistanceValue(landmarks) {
    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    const distance = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);

    const MIN_DIST = 0.05;
    const MAX_DIST = 0.35;
    // Python এর int() zero এর দিকে truncate করে, তাই Math.round নয়, Math.trunc ব্যবহার হলো
    let value = Math.trunc((distance - MIN_DIST) / (MAX_DIST - MIN_DIST) * 255);

    if (value < 0) value = 0;
    else if (value > 255) value = 255;
    return value;
}

// প্রতিটা আঙুল উপরে তোলা কিনা বের করা — Python এর tip_ids = [4, 8, 12, 16, 20] লজিক অনুযায়ী
// রিটার্ন করে [thumb, index, middle, ring, pinky], প্রতিটা 1 (up) অথবা 0 (down)
function getFingersUp(landmarks) {
    const tipIds = [4, 8, 12, 16, 20];
    const fingersUp = [];

    // থাম্ব: x কোঅর্ডিনেট কম্পেয়ার (থাম্ব সাইডওয়েজ নড়ে, তাই y নয় x ব্যবহার হয়)
    if (landmarks[tipIds[0]].x < landmarks[tipIds[0] - 1].x) {
        fingersUp.push(1);
    } else {
        fingersUp.push(0);
    }

    // বাকি ৪ আঙুল: y কোঅর্ডিনেট কম্পেয়ার
    for (let i = 1; i < 5; i++) {
        if (landmarks[tipIds[i]].y < landmarks[tipIds[i] - 2].y) {
            fingersUp.push(1);
        } else {
            fingersUp.push(0);
        }
    }

    return fingersUp;
}

// আঙুলের অবস্থা থেকে গেসচার বের করা — Python এর get_gesture() ফাংশনের এক্সাক্ট লজিক
function getGesture(landmarks) {
    const fingersUp = getFingersUp(landmarks); // [thumb, index, middle, ring, pinky]
    const totalFingers = fingersUp.reduce((a, b) => a + b, 0);

    // টেস্টিং এর জন্য: প্রতি ফ্রেমে আঙুলের অবস্থা দেখতে চাইলে নিচের লাইনটা আনকমেন্ট করুন
    // console.log("[FINGERS]", fingersUp, "| total =", totalFingers);

    let gesture = null;
    if (totalFingers === 5) gesture = 'F';
    else if (totalFingers === 0) gesture = 'S';
    else if (fingersUp[1] === 1 && totalFingers === 1) gesture = 'R';  // শুধু ইনডেক্স আপ = ডানে
    else if (fingersUp[2] === 1 && totalFingers === 1) gesture = 'L';  // শুধু মিডল আপ = বামে
    else if (fingersUp[2] === 1 && fingersUp[1] === 1 && totalFingers === 2) gesture = 'L'; // ইনডেক্স+মিডল (V সাইন) = বামে
    else if (fingersUp[4] === 1 && totalFingers === 1) gesture = 'B';  // শুধু পিংকি আপ = পিছনে
    else if (fingersUp[0] === 1 && fingersUp[1] === 1 && fingersUp[2] === 0 && fingersUp[3] === 0 && fingersUp[4] === 0) gesture = 'D'; // থাম্ব+ইনডেক্স = লাইট কন্ট্রোল

    console.log("[GESTURE]", gesture, "| fingersUp =", fingersUp); // টেস্টিং এর জন্য
    return gesture;
}

const videoElement = document.getElementById('videoElement');
const canvasElement = document.getElementById('canvasElement');
const canvasCtx = canvasElement.getContext('2d');

// Python এর send_interval = 0.5 (সেকেন্ড) এর সমতুল্য — প্রতি ০.৫ সেকেন্ডে সর্বোচ্চ একবার কমান্ড পাঠানো হবে
const SEND_INTERVAL_MS = 500;
let lastSentTime = 0;

function onResults(results) {
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    let finalCommand = null;

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const landmarks = results.multiHandLandmarks[0];

        drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, {color: '#00ffcc', lineWidth: 2});
        drawLandmarks(canvasCtx, landmarks, {color: '#ff0000', lineWidth: 1});

        const gesture = getGesture(landmarks);

        if (gesture === 'D') {
            const distanceValue = getDistanceValue(landmarks);
            finalCommand = String(distanceValue);
            console.log("[LIGHT] distanceValue =", distanceValue); // টেস্টিং এর জন্য

            // স্লাইডার UI প্রতি ফ্রেমেই লাইভ আপডেট হবে (visual feedback), যদিও BLE তে পাঠানো হয় থ্রটল করে
            const slider = document.getElementById('lightSlider');
            const sliderValueEl = document.getElementById('sliderValue');
            if (slider) slider.value = distanceValue;
            if (sliderValueEl) sliderValueEl.innerText = distanceValue;
        } else {
            finalCommand = gesture; // null ও হতে পারে (কোনো পরিচিত gesture না মিললে)
        }
    } else {
        console.log("[HAND] কোনো হাত শনাক্ত হয়নি"); // টেস্টিং এর জন্য
    }

    // Python কোডের মতোই: শুধু ইন্টারভাল পার হলে পাঠানো হবে, content dedup চেক করা হচ্ছে না
    // (তাই একই কমান্ড ধরে রাখলে প্রতি ০.৫ সেকেন্ডে আবার পাঠানো হবে — F_BLOCKED/B_BLOCKED থেকে রিকভার করতেও এটা সাহায্য করবে)
    const now = Date.now();
    if (finalCommand !== null && (now - lastSentTime > SEND_INTERVAL_MS)) {
        sendCommand(finalCommand, true);
        lastSentTime = now;
    } else if (finalCommand !== null) {
        console.log("[THROTTLED] skip sending, cmd =", finalCommand, "| ms since last send =", now - lastSentTime); // টেস্টিং এর জন্য
    }

    canvasCtx.restore();
}

const hands = new Hands({locateFile: (file) => {
    return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
}});

hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.7
});
hands.onResults(onResults);

const camera = new Camera(videoElement, {
    onFrame: async () => {
        canvasElement.width = videoElement.videoWidth;
        canvasElement.height = videoElement.videoHeight;
        await hands.send({image: videoElement});
    },
    width: 320,
    height: 240
});
camera.start();
