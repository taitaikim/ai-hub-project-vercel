// [A.I.K.H. 2.0] Vercel 서버리스 함수
// 경로: /api/kakao.js

// --- 1. 엔진 임포트 (package.json 기반) ---
// Vercel은 'package.json'을 보고 이 부품들을 '자동' 설치합니다.
import { initializeApp, cert, getApps, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { OpenAI } from 'openai';
import { Client } from '@notionhq/client';

// --- 2. 엔진 초기화 (Vercel 환경 변수 사용) ---

// [Firebase 엔진] (Vercel의 '재사용' 정책에 맞춘 초기화)
// (중요!) Vercel 환경 변수 'FIREBASE_SERVICE_ACCOUNT_JSON'에 
// serviceAccountKey.json 파일의 '내용 전체'를 '텍스트'로 복사해야 합니다.
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');

// getApps()로 이미 초기화되었는지 확인 (서버리스 함수 '필수' 로직)
const app = !getApps().length
  ? initializeApp({ credential: cert(serviceAccount) })
  : getApp();

const db = getFirestore(app);
const auth = getAuth(app);

// [OpenAI 엔진]
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// [Notion 엔진] (최신 '2025-09-03' 버전)
const notion = new Client({ 
    auth: process.env.NOTION_API_KEY,
    notionVersion: '2025-09-03'
});
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;


// --- 3. Vercel API 핸들러 (메인 로직) ---
// Vercel은 이 'handler' 함수를 '자동으로' 실행합니다.
export default async function handler(req, res) {

    // [보안] Vercel은 'express'가 없으므로, 'POST' 요청만 받도록 '수동' 설정합니다.
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    console.log('💬 [카카오] Vercel 워크플로우 시작!');
    let responseMessage = ""; 

    // 'req.body' 사용은 Express와 동일합니다.
    const requestBody = req.body;

    try {
        const userMessage = requestBody.userRequest.utterance;
        const kakaoChatId = requestBody.userRequest.user.id; 

        // [명령어 분석 1] '/연결' 명령인가?
        if (userMessage.startsWith('/연결 ')) {
            const code = userMessage.split(' ')[1]; 
            console.log(`💬 [카카오] 계정 연결 시도... (코드: ${code})`);

            const codeRef = db.collection('linkCodes').doc(code);
            const codeDoc = await codeRef.get();

            if (!codeDoc.exists) { throw new Error('코드가 존재하지 않습니다.'); }
            if (codeDoc.data().expiresAt.toDate() < new Date()) {
                await codeRef.delete(); 
                throw new Error('코드가 만료되었습니다.');
            }

            const firebaseUid = codeDoc.data().uid;

            // '양방향' 연결 (기존 server.js 로직과 100% 동일)
            const fbRef = db.collection('userMappingsByFirebaseUid').doc(firebaseUid);
            await fbRef.set({ kakaoChatId: kakaoChatId });
            const kakaoRef = db.collection('userMappingsByKakaoId').doc(kakaoChatId);
            await kakaoRef.set({ firebaseUid: firebaseUid });
            
            await codeRef.delete();

            console.log(`✅ [계정 연결] '${kakaoChatId}' <-> '${firebaseUid}' 영구 연결 성공!`);
            responseMessage = "✅ 계정 연결 성공! 이제부터 보내는 메모는 사장님의 Notion에 자동 저장됩니다.";
        } 
        // [명령어 분석 2] '일반 메모'인가?
        else {
            console.log(`💬 [카카오] 일반 메모 저장 시도... (카톡ID: ${kakaoChatId})`);
            
            const mappingRef = db.collection('userMappingsByKakaoId').doc(kakaoChatId);
            const mappingDoc = await mappingRef.get();
            if (!mappingDoc.exists) { throw new Error('auth/user-not-found'); }
            
            const firebaseUid = mappingDoc.data().firebaseUid;
            console.log(`✅ [계정 확인] '${kakaoChatId}' -> '${firebaseUid}' (기존 사용자)`);

            // [공용 함수] (파일 하단에 정의됨)
            const aiSummary = await getAiSummary(userMessage);
            const savedDate = new Date();

            const docRef = await db.collection('memos').add({
                uid: firebaseUid, 
                text: userMessage,
                summary: aiSummary,
                createdAt: savedDate,
                notionPageId: null 
            });
            const firebaseId = docRef.id; 
            console.log('🚀 [Firebase] 카카오 메모 저장 성공!');
            
            // [공용 함수] (파일 하단에 정의됨)
            const notionPage = await saveToNotion(firebaseUid, userMessage, aiSummary, savedDate, firebaseId);
            console.log('🚀 [Notion] 카카오 메모를 Notion DB에 동시 저장 성공!');

            await docRef.update({ notionPageId: notionPage.id });

            responseMessage = `✅ [AI 허브] 저장 완료!\n(Notion DB를 확인해 보세요!)`;
        }

    } catch (error) {
        // [오류 처리] (기존 server.js 로직과 100% 동일)
        console.error('🔥 [카카오] Vercel 처리 중 심각한 오류!', error);
        if (error.message === 'auth/user-not-found') {
            responseMessage = "❌ 계정 연결이 필요합니다!\n\n웹사이트에 로그인 후, [카카오톡 계정 연결] 버튼을 눌러 '1회용 코드'를 발급받아 '/연결 [코드]'를 보내주세요!";
        } else if (error.message.includes('코드')) {
            responseMessage = `❌ ${error.message} 다시 시도해주세요.`;
        } else {
            responseMessage = "❌ 죄송합니다, AI 허브 저장에 실패했습니다...";
        }
    }

    // --- 4. 카카오톡에 응답 전송 ---
    // Vercel은 'res.json()' 또는 'res.status().json()'을 사용합니다.
    const kakaoResponse = {
        version: "2.0",
        template: { outputs: [ { simpleText: { text: responseMessage } } ] }
    };
    
    // HTTP 200 OK와 함께 이 JSON을 응답으로 보냅니다.
    return res.status(200).json(kakaoResponse);
}


// --- 🛠️ (공용 함수) AI 요약 ---
// (Vercel에서는 'handler' 외부에 함수를 두어 '재사용'합니다.)
async function getAiSummary(text) {
    console.log('🤖 [AI] (공용함수) 요약 요청...');
    const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
            { role: "system", content: "You are a helpful assistant that summarizes text in one concise Korean sentence." },
            { role: "user", content: text }
        ],
    });
    return completion.choices[0].message.content;
}

// --- 🛠️ (공용 함수) Notion 저장 ---
async function saveToNotion(uid, text, summary, date, firebaseId) {
    // (기존 'saveToNotion' 함수와 100% 동일합니다)
    const response = await notion.pages.create({
        parent: { database_id: NOTION_DATABASE_ID },
        properties: {
            "Original Text": { title: [ { text: { content: text.substring(0, 100) } } ] },
            "AI Summary": { rich_text: [ { text: { content: summary } } ] },
            "Firebase UID": { rich_text: [ { text: { content: uid } } ] },
            "Saved At": { date: { start: date.toISOString() } },
            "Firebase Doc ID": { rich_text: [ { text: { content: firebaseId } } ] }
        }
    });
    return response; 
}