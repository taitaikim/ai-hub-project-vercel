// [A.I.K.H. 3.0] Vercel 서버리스 함수 (Final Fix: LWW 시간 검증 모드)
// 경로: /api/notion-webhook.js

import { initializeApp, cert, getApps, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { OpenAI } from 'openai';
import { getAiSummary } from './lib/ai-hub.js'; 
import { createHmac, timingSafeEqual } from 'crypto'; 

// --- 1. 엔진 초기화 및 보안 변수 ---
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
const app = !getApps().length
  ? initializeApp({ credential: cert(serviceAccount) })
  : getApp();
const db = getFirestore(app);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const VERIFICATION_TOKEN = process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN; 

// --- 2. Notion 서명 검증 함수 (임시 비활성화 유지) ---
function validateNotionSignature(rawBody, headers) {
    // ... (복잡한 로직은 생략하고 토큰이 유효하다고 가정)
    return true; 
}

// --- 3. Vercel API 핸들러 (LWW 로직 최종 수정) ---
export default async function handler(req, res) {
    if (req.method !== 'POST') { return res.status(405).json({ message: 'Method Not Allowed' }); }
    
    // [Raw Body 읽기] (Signature 검증을 위해 필요)
    const chunks = [];
    for await (const chunk of req) { chunks.push(chunk); }
    const rawBody = Buffer.concat(chunks).toString('utf8');
    const event = JSON.parse(rawBody); 

    // [1단계] Notion '인증 토큰' 회수 (최초 1회만 실행)
    if (event.verification_token) {
        console.log(`⭐️ 복사할 토큰: ${event.verification_token} ⭐️`);
        return res.status(200).json({ message: 'Verification token received. Please save it to Vercel Env Vars.' });
    }
    
    // [2단계] 서명 검증 (임시 우회)
    /* if (!validateNotionSignature(rawBody, req.headers)) { return res.status(401).json({ message: 'Unauthorized Signature' }); } */
    
    try {
        // --- 3. Handle UPDATE (수정 이벤트 처리) ---
        if (event.event === 'page.property_value.changed' || event.event === 'page.content_updated') {
            
            // 3-1. Notion의 최종 수정 시간 확보 (event.last_edited_time 경로 사용)
            const notionLastEdited = new Date(event.last_edited_time); 
            
            const firebaseId = event.properties["Firebase Doc ID"]?.rich_text[0]?.text.content || null;
            if (!firebaseId) { return res.status(200).json({ message: 'No Firebase ID.' }); }

            const docRef = db.collection('memos').doc(firebaseId);
            const doc = await docRef.get();
            if (!doc.exists) { return res.status(200).json({ message: 'Firebase doc not found.' }); }
            
            // 3-2. Firebase의 현재 저장된 수정 시간 확보
            const firebaseLastEdited = new Date(doc.data().lastEditedAt.toDate()); 

            // --- 👇 [구간 테스트 1] 시간 데이터 출력 및 즉시 종료 👇 ---
            return res.status(200).json({ 
                message: "DEBUG: Time Check (LWW Test 1)",
                notion_time_iso: notionLastEdited.toISOString(), // 사람이 읽을 수 있는 Notion 시간
                firebase_time_iso: firebaseLastEdited.toISOString(), // 사람이 읽을 수 있는 Firebase 시간
                notion_time_ms: notionLastEdited.getTime(), // 비교에 사용되는 Notion 시간 (밀리초)
                firebase_time_ms: firebaseLastEdited.getTime(), // 비교에 사용되는 Firebase 시간 (밀리초)
            });
            // --- 👆 [구간 테스트 1] 시간 데이터 출력 및 즉시 종료 👆 ---

            // 3-3. 🔴 LWW 비교: Notion의 시간이 Firebase보다 '최신'인지 확인
            // ... (이하는 실행되지 않음) ...
            
        }
        
        // ... (rest of the code: delete logic, etc.) ...
        return res.status(200).json({ message: 'Event received but not processed.' });

    } catch (error) {
        console.error("🔥 [Notion Webhook] 실시간 동기화 중 심각한 오류 발생!", error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
}