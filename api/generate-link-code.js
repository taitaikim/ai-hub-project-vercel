// [A.I.K.H. 2.0] Vercel 서버리스 함수
// 경로: /api/generate-link-code.js

// --- 1. '중앙 통제실'에서 '부품' 가져오기 ---
import { db, verifyToken } from '../../_lib/firebaseAdmin.js';
// (Firebase 초기화 코드가 '완전히' 사라졌습니다!)

// --- 2. Vercel API 핸들러 (메인 로직) ---
export default async function handler(req, res) {

    // [보안 1] GET 요청만 허용
    if (req.method !== 'GET') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    // [보안 2] '보안 검사관' 호출!
    // '중앙 통제실'에서 가져온 'verifyToken' 함수를 실행합니다.
    const user = await verifyToken(req, res);
    
    // 'user'가 'null'이면 (인증 실패), '보안 검사관'이 이미 401/403 응답을 보냈으므로
    // 여기서는 '즉시' 함수를 종료합니다.
    if (!user) {
        return; 
    }

    // --- 3. '인증된 사용자'만 실행하는 비즈니스 로직 ---
    // (기존 server.js의 로직과 100% 동일)
    try {
        const uid = user.uid; 
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const expiration = new Date(Date.now() + 5 * 60 * 1000); // 5분

        // '중앙 통제실'에서 가져온 'db'를 사용합니다.
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