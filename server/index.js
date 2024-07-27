const { onRequest } = require("firebase-functions/v2/https");
const { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } = require("@google/generative-ai");
const sharp = require('sharp');
const os = require('os');
const path = require('path');
const fs = require('fs');
const Busboy = require('busboy');
const cors = require('cors');
const { initializeApp } = require('firebase-admin/app');
const { getAppCheck } = require('firebase-admin/app-check');
const { log } = require("console");

initializeApp();

const genAI = new GoogleGenerativeAI(process.env.API_KEY);

exports.analyzeImage = onRequest({cors:["#"]}, async (req, res) => {
    // Verify the App Check token

    const appCheckToken = req.header('X-Firebase-AppCheck');
    if (!appCheckToken) {
        return res.status(401).json({ error: "Unauthorized: Missing App Check token" });
    }

    try {
        await getAppCheck().verifyToken(appCheckToken);
    } catch (error) {
        console.error("Error verifying App Check token:", error);
        return res.status(401).json({ error: "Unauthorized: Invalid App Check token" });
    }

    // Enable CORS using the 'cors' middleware
    cors({
        origin: '#',
        methods: ['POST'],
        credentials: true,
    })(req, res, async () => {
        if (req.method !== 'POST') {
            return res.status(405).end();
        }

        const busboy = Busboy({ headers: req.headers });
        let imageBuffer;
        let imageFileName;

        busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
            if (fieldname !== 'image') {
                file.resume();
                return;
            }

            const chunks = [];
            file.on('data', (chunk) => chunks.push(chunk));
            file.on('end', () => {
                imageBuffer = Buffer.concat(chunks);
                imageFileName = filename;
            });
        });

        busboy.on('finish', async () => {
            if (!imageBuffer) {
                return res.status(400).json({ error: "No image file uploaded" });
            }

            try {
                // Process the image using Sharp
                const processedImageBuffer = await sharp(imageBuffer)
                    .resize(512, 512)
                    .jpeg()
                    .toBuffer();
                
                // Create a temporary file path
                const tempFilePath = path.join(os.tmpdir(), `image_${Date.now()}.jpg`);

                // Save the processed image to the temporary file
                fs.writeFileSync(tempFilePath, processedImageBuffer);

                // Converts local file information to a GoogleGenerativeAI.Part object.
                function fileToGenerativePart(path, mimeType) {
                    return {
                        inlineData: {
                            data: Buffer.from(fs.readFileSync(path)).toString("base64"),
                            mimeType
                        },
                    };
                }
                
                // Turn images to Part objects
                const filePart1 = fileToGenerativePart(tempFilePath, "image/jpeg")
                const imageParts = [filePart1];

                // Prepare the prompt for Gemini
                const prompt = `Instruction
                Which Pokemon character suits me best? And why? Briefly describe the basis for your character. The response must be in JSON format and should not include any additional commentary. Regardless of the image quality or other factors, always provide character and description.
                
                Example
                response: {"character": "Snorlax", "reason": "Snorlax is a large, lazy Pokemon that is known for its love of food and sleep. You have a similar build and seem to enjoy relaxing. You also appear to be a kind and gentle person, which are all qualities that Snorlax is known for."}
                response: {"character": "Pikachu", "reason": "Pikachu is a small, electric Pokemon that is known for its energy and playful nature. You have a similar youthful energy and seem to be very friendly. You also appear to be intelligent and quick-witted, which are all qualities that Pikachu is known for."}
                response: {"character": "Bulbasaur", "reason": "Bulbasaur is a grass-type Pokemon that is known for its calm and collected nature. You have a similar sense of peace and seem to be very grounded. You also appear to be kind and caring, which are all qualities that Bulbasaur is known for."}

                By clearly instructing the AI to avoid additional commentary and focus on a straightforward score and reason, the responses should become more direct and aligned with your requirements.`;

                const model = genAI.getGenerativeModel({
                    model: 'gemini-1.5-flash',
                    safetySetting: [
                        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                        { category: HarmCategory.HARM_CATEGORY_UNSPECIFIED, threshold: HarmBlockThreshold.BLOCK_NONE },
                    ],
                    generationConfig: { responseMimeType: "application/json" }
                });

                const result = await model.generateContent([prompt, ...imageParts]);
                const response = await result.response;
                const text = response.text();
                
                // Clean up the temporary file
                fs.unlinkSync(tempFilePath);

                const characterResult = JSON.parse(text).character;
                //console.info("JSON.parse(text) : ", text);
                console.info("JSON.parse(text).character : ", characterResult);
                // Prepare the prompt for Gemini
                let goodPrompt = `Can you tell me the top 3 Pokemon that have a good personality compatibility with ` + characterResult;
    
                goodPrompt += `
                Example
                response: ["character": "Eevee", "reason": "Eevee's friendly and loyal nature perfectly complements Snorlax's gentle and laid-back personality. They both value companionship and peacefulness, making them ideal companions for a relaxed, cozy life."},
                {"character": "Lapras", "reason": "This gentle giant is known for its caring and nurturing nature. Lapras's kindness and desire to help others would resonate with Snorlax's inherent goodness. They could enjoy leisurely swims together, or simply share quiet moments basking in the sun, enjoying each other's company."},
                {"character": "Snorunt", "reason": "While Snorunt is a bit more mischievous and playful than Snorlax, they share a love for sleep and relaxation. Snorunt's energetic bursts of play could be a source of amusement for Snorlax, who would likely appreciate Snorunt's company as it's not afraid to try new things."}]
    
                By clearly instructing the AI to avoid additional commentary and focus on a straightforward character and reason, the responses should become more direct and aligned with your requirements.`;
    
                //console.info("goodPrompt : " + goodPrompt);
    
                const goodResult = await model.generateContent(goodPrompt);
                const goodResponse = await goodResult.response;
                const goodText = goodResponse.text();
    
    
                let badPrompt = `Can you tell me the top 3 Pokemon that have a bad personality compatibility with ` + characterResult;
    
                badPrompt += `
                Example
                response: ["character": "Eevee", "reason": "Eevee's friendly and loyal nature perfectly complements Snorlax's gentle and laid-back personality. They both value companionship and peacefulness, making them ideal companions for a relaxed, cozy life."},
                {"character": "Lapras", "reason": "This gentle giant is known for its caring and nurturing nature. Lapras's kindness and desire to help others would resonate with Snorlax's inherent goodness. They could enjoy leisurely swims together, or simply share quiet moments basking in the sun, enjoying each other's company."},
                {"character": "Snorunt", "reason": "While Snorunt is a bit more mischievous and playful than Snorlax, they share a love for sleep and relaxation. Snorunt's energetic bursts of play could be a source of amusement for Snorlax, who would likely appreciate Snorunt's company as it's not afraid to try new things."}]
    
                By clearly instructing the AI to avoid additional commentary and focus on a straightforward character and reason, the responses should become more direct and aligned with your requirements.`;
    
                //console.info("badPrompt : " + badPrompt);
    
                const badResult = await model.generateContent(badPrompt);
                const badResponse = await badResult.response;
                const badText = badResponse.text();
                //console.info("goodText : ", goodText);
    
                let finalResult = JSON.stringify({ character: JSON.parse(text).character, reason: JSON.parse(text).reason, good:JSON.parse(goodText), bad:JSON.parse(badText)}); 
    
                //console.info("finalResult : " + finalResult);
                // Return the structured response
                res.status(200).json(JSON.parse(finalResult));

            } catch (error) {
                console.error("Error analyzing image:", error);
                res.status(500).json({ error: "Internal Server Error" });
            }
        });

        busboy.end(req.rawBody);
    });
});