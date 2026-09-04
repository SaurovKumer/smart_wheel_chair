// --- ১. টেলিগ্রাম বট দিয়ে অ্যালার্ট ও জিপিএস লোকেশন পাঠানোর সেটআপ ---
const TELEGRAM_BOT_TOKEN = "8795724835:AAE-xYFohqnPckaSKdrMygLBiruFJMN3Eow";
const TELEGRAM_CHAT_ID = "5199115006";

function sendTelegramAlert(baseMessage) {
    // আগে এখানে কোনো timeout ছিল না, তাই GPS ফিক্স না পেলে
    // getCurrentPosition() চিরকাল আটকে থাকতো আর টেলিগ্রাম মেসেজ কখনোই যেত না।
    // ফিক্স: নির্দিষ্ট timeout + একটা fallback timer, যাতে GPS না পেলেও অ্যালার্ট ঠিকই যায়।
    let alreadySent = false;
    const sendOnce = (message) => {
        if (alreadySent) return;
        alreadySent = true;
        sendTelegramMessage(message);
    };

    // সেফটি নেট: ৫ সেকেন্ডের মধ্যে GPS রেসপন্স না পেলে লোকেশন ছাড়াই অ্যালার্ট পাঠাও
    const fallbackTimer = setTimeout(() => {
        sendOnce(`${baseMessage}\n📍 Location: Unavailable (Timeout)`);
    }, 5000);

    try {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    clearTimeout(fallbackTimer);
                    const lat = position.coords.latitude;
                    const lon = position.coords.longitude;
                    const googleMapsLink = `https://www.google.com/maps?q=${lat},${lon}`;
                    sendOnce(`${baseMessage}\n📍 Location: ${googleMapsLink}`);
                },
                (error) => {
                    clearTimeout(fallbackTimer);
                    console.log("Location access denied.", error);
                    sendOnce(`${baseMessage}\n📍 Location: Unavailable (Permission Denied)`);
                },
                { enableHighAccuracy: false, timeout: 4000, maximumAge: 60000 }
            );
        } else {
            clearTimeout(fallbackTimer);
            sendOnce(baseMessage);
        }
    } catch (err) {
        // কিছু ব্রাউজার/পলিসি সেটআপে getCurrentPosition() সরাসরি throw করতে পারে
        clearTimeout(fallbackTimer);
        console.error("Geolocation threw synchronously:", err);
        sendOnce(`${baseMessage}\n📍 Location: Unavailable (Error)`);
    }
}

function sendTelegramMessage(text) {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    
    fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text })
    })
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
        
        // আনলক সফল হলে লক স্ক্রিন সরিয়ে দাও
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

        // 🚨 গাড়ি অফ/ডিসকানেক্ট হলে
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

        // 🚨 গাড়ি আটকে গেলে (STUCK)
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

async function sendCommand(cmd) {
    if (!isConnected || !rxCharacteristic) return;
    if (cmd === lastCommand) return; 
    try {
        const encoder = new TextEncoder();
        await rxCharacteristic.writeValue(encoder.encode(cmd));
        lastCommand = cmd;
    } catch (error) {
        console.log("Send Error:", error);
    }
}

// --- ৪. ম্যানুয়াল কন্ট্রোল বাটন লজিক ---
const bindButton = (id, cmd) => {
    const btn = document.getElementById(id);
    if(btn) {
        btn.addEventListener('mousedown', () => sendCommand(cmd));
        btn.addEventListener('touchstart', (e) => { e.preventDefault(); sendCommand(cmd); });
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

// --- ৫. ক্যামেরা এবং MediaPipe জেসচার লজিক ---
const videoElement = document.getElementById('videoElement');
const canvasElement = document.getElementById('canvasElement');
const canvasCtx = canvasElement.getContext('2d');

// --- জেসচার স্ট্যাবিলিটি (ডিবাউন্স) ---
// আগে প্রতি ফ্রেমেই সাথে সাথে কমান্ড পাঠানো হতো, ফলে সামান্য misread হলেই (বিশেষ করে
// "Backward"-এর ৩-আঙুল পোজ, যেটা স্থির রাখা কঠিন) কমান্ড ফ্লিকার করতো। এখন একটানা কয়েক
// ফ্রেম একই জেসচার দেখলে তবেই কমান্ড পাঠানো হবে।
let pendingGesture = null;
let pendingGestureCount = 0;
const GESTURE_CONFIRM_FRAMES = 4;

// হাত ফ্রেম থেকে সরে গেলে সেফটির জন্য অটো-স্টপ
let noHandFrames = 0;
const NO_HAND_STOP_FRAMES = 15; // ~0.5s ক্যামেরা ফ্রেমরেটে

function confirmAndSend(gesture) {
    if (gesture === pendingGesture) {
        pendingGestureCount++;
    } else {
        pendingGesture = gesture;
        pendingGestureCount = 1;
    }
    if (pendingGestureCount !== GESTURE_CONFIRM_FRAMES) return;

    // আগে ক্যামেরা জেসচার দিয়ে লাইট অন/অফ করার কোনো লজিকই ছিলো না, শুধু বাটন দিয়ে হতো।
    if (gesture === "LIGHT_ON") {
        document.getElementById('lightSlider').value = 255;
        document.getElementById('sliderValue').innerText = 255;
        sendCommand("255");
    } else if (gesture === "LIGHT_OFF") {
        document.getElementById('lightSlider').value = 0;
        document.getElementById('sliderValue').innerText = 0;
        sendCommand("0");
    } else {
        sendCommand(gesture);
    }
}

function onResults(results) {
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        noHandFrames = 0;
        const landmarks = results.multiHandLandmarks[0];
        
        drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, {color: '#00ffcc', lineWidth: 2});
        drawLandmarks(canvasCtx, landmarks, {color: '#ff0000', lineWidth: 1});

        const isIndexUp = landmarks[8].y < landmarks[6].y;
        const isMiddleUp = landmarks[12].y < landmarks[10].y;
        const isRingUp = landmarks[16].y < landmarks[14].y;
        const isPinkyUp = landmarks[20].y < landmarks[18].y;
        const isThumbUp = landmarks[4].y < landmarks[3].y && landmarks[4].y < landmarks[2].y;

        let fingersUpCount = isIndexUp + isMiddleUp + isRingUp + isPinkyUp;

        let gesture = null;
        if (fingersUpCount === 4) {
            gesture = "F";
        } else if (fingersUpCount === 0 && isThumbUp) {
            gesture = "LIGHT_ON";      // 👍 বন্ধ মুষ্টি + বৃদ্ধাঙ্গুলি উঁচু = Light ON
        } else if (fingersUpCount === 0) {
            gesture = "S";
        } else if (fingersUpCount === 2 && isIndexUp && isMiddleUp) {
            gesture = "R";
        } else if (fingersUpCount === 1 && isPinkyUp) {
            gesture = "LIGHT_OFF";     // শুধু কনিষ্ঠা আঙুল উঁচু = Light OFF
        } else if (fingersUpCount === 1 && isIndexUp) {
            gesture = "L";
        } else if (fingersUpCount === 3) {
            gesture = "B";
        }

        if (gesture) confirmAndSend(gesture);
    } else {
        // হাত দেখা যাচ্ছে না — কিছুক্ষণ পরও না দেখলে নিরাপত্তার জন্য গাড়ি থামিয়ে দাও
        pendingGesture = null;
        pendingGestureCount = 0;
        noHandFrames++;
        if (noHandFrames === NO_HAND_STOP_FRAMES) {
            sendCommand("S");
        }
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