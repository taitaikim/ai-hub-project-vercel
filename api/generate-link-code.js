// [A.I.K.H. 2.0] Vercel 서버리스 함수 (Final Fix)
// 경로: /api/generate-link-code.js
// (버그: 'import' 경로를 'ai-hub.js'로 수정)

// --- 1. '중앙 통제실'에서 '부품' 가져오기 ---
// 
// [수정!] '../../_lib/firebaseAdmin.js' (X) 
// [수정!] '../../_lib/ai-hub.js' (O)
//
import { db, verifyToken } from '../../_lib/ai-hub.js';

// --- 2. Vercel API 핸들러 (메인 로직) ---
export default async function handler(req, res) {

    // [보안 1] GET 요청만 허용 (기존과 동일)
    if (req.method !== 'GET') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    // [보안 2] '보안 검사관' 호출! (기존과 동일)
    const user = await verifyToken(req, res);
    if (!user) {
        return; 
    }

    // --- 3. '인증된 사용자'만 실행하는 비즈니스 로직 ---
    // (기존 server.js의 로직과 100% 동일)
    try {
        const uid = user.uid; 
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const expiration = new Date(Date.now() + 5 * 60 * 1000); // 5분

        await db.collection('linkCodes').doc(code).set({
            uid: uid,
            expiresAt: expiration
        });
        
        console.log(`✅ [Vercel] '${uid}' 손님에게 '1회용 코드(${code})' 발급 완료.`);
        // [성공]
        return res.status(200).json({ code: code });

    } catch (error) {
        console.error("🔥 [Vercel] 1회용 코드 발급 실패!", error);
        // [실패]
        return res.status(500).json({ message: "코드 발급 중 오류 발생" });
    }
}