// [A.I.K.H. 3.0] Vercel 서버리스 함수 (Zero-Error / '공식 보안' 탑재)
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
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});
const NOTION_WEBHOOK_VERIFICATION_TOKEN = process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN; // Env Var에서 토큰 가져옴

// --- 2. [핵심 공용 함수] Notion 서명 검증 ---
function validateNotionSignature(rawBody, headers) {
    const signature = headers['x-notion-signature'];
    if (!signature) {
        // 서명이 없거나, 아직 verification_token이 Vercel에 설정 안 된 상태라면 일단 통과시키지 않음
        return false;
    }
    
    // Vercel Env Var에 토큰이 없으면 무조건 실패 (토큰 설정 유도)
    if (!NOTION_WEBHOOK_VERIFICATION_TOKEN) {
        return false; 
    }

    const calculatedSignature = `sha256=${createHmac("sha256", NOTION_WEBHOOK_VERIFICATION_TOKEN)
        .update(rawBody) // ⬅️ [중요] 원본(raw) body를 사용하여 서명 계산!
        .digest("hex")}`;

    // TimingSafeEqual을 사용하여 토큰 노출 없이 안전하게 비교
    try {
        return timingSafeEqual(
            Buffer.from(calculatedSignature),
            Buffer.from(signature)
        );
    } catch (e) {
        // 비교 과정에서 버퍼 길이가 다를 때 에러 발생 방지
        return false;
    }
}

// --- 3. Vercel API 핸들러 (메인 로직) ---
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }
    
    // [중요!] Node.js의 'Readable Stream'에서 'Raw Body'를 직접 읽어옴
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(chunk);
    }
    const rawBody = Buffer.concat(chunks).toString('utf8');
    
    // 원본 텍스트를 파싱하여 이벤트 객체를 얻음
    const event = JSON.parse(rawBody); 

    // --- 👇 [1단계] Notion '인증 토큰(verification_token)' 회수 로직 👇 ---
    if (event.verification_token) {
        console.log("✅ [Notion Webhook] '최초 검증 토큰' 수신!");
        console.log(`⭐️ 복사할 토큰: ${event.verification_token} ⭐️`); // ⬅️ 이 토큰을 Vercel Env Var에 저장하세요!
        return res.status(200).json({ message: 'Verification token received. Please save it to Vercel Env Vars.' });
    }
    
    // [2단계] 서명 검증 (데이터 무결성 확인)
    if (!validateNotionSignature(rawBody, req.headers)) {
        console.warn("🔥 [Notion Webhook] 서명 불일치! 데이터 거부.");
        return res.status(401).json({ message: 'Unauthorized Signature' });
    }
    
    // --- (서명 검증 통과: 동기화 시작) ---
    // ... (이하 '동기화' 로직 유지) ...
    // ... (event.event === 'page.property_value.changed' 및 'page.archived' 로직 유지) ...
    // ... (이하 로직은 기존 코드 참조) ...
    
    try {
        // 3. Handle UPDATE
        if (event.event === 'page.property_value.changed') {
            console.log("🔄 [Notion Webhook] '페이지 수정' 신호 수신!");
            const firebaseId = event.properties["Firebase Doc ID"]?.rich_text[0]?.text.content || null;
            const newNotionText = event.properties["Original Text"]?.title[0]?.text.content || '';
            
            if (!firebaseId || event.property_name !== "Original Text") {
                 return res.status(200).json({ message: 'Property change ignored.' });
            }
            // ... (rest of the update logic) ...
            return res.status(200).json({ message: 'Sync successful!' });
        }

        // 4. Handle DELETE
        if (event.event === 'page.archived' || event.event === 'page.deleted') {
            console.log("🔄 [Notion Webhook] '페이지 삭제(보관)' 신호 수신!");
            const firebaseId = event.properties["Firebase Doc ID"]?.rich_text[0]?.text.content || null;
            if (!firebaseId) {
                return res.status(200).json({ message: 'Sync skipped: Firebase ID not found.' });
            }
            const docRef = db.collection('memos').doc(firebaseId);
            await docRef.delete();
            return res.status(200).json({ message: 'Delete sync successful!' });
        }
        
        // 그 외 이벤트 (무시)
        return res.status(200).json({ message: 'Event received but not processed.' });

    } catch (error) {
        console.error("🔥 [Notion Webhook] '실시간 동기화' 중 심각한 오류 발생!", error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
}