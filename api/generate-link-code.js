// [A.I.K.H. 2.0] Vercel 서버리스 함수 (Final Fix 2)
// 경로: /api/generate-link-code.js
// (버그: 'import' 경로를 '../'로 수정)

// --- 1. '중앙 통제실'에서 '부품' 가져오기 ---
// 
// [수정!] '../../_lib/ai-hub.js' (X) 
// [수정!] '../_lib/ai-hub.js' (O)
//
import { db, verifyToken } from '../_lib/ai-hub.js';

// --- (이하 코드는 100% 동일) ---
export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }
    const user = await verifyToken(req, res);
    if (!user) {
        return; 
    }
    try {
        const uid = user.uid; 
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const expiration = new Date(Date.now() + 5 * 60 * 1000); // 5분
        await db.collection('linkCodes').doc(code).set({
            uid: uid,
            expiresAt: expiration
        });
        console.log(`✅ [Vercel] '${uid}' 손님에게 '1회용 코드(${code})' 발급 완료.`);
        return res.status(200).json({ code: code });
    } catch (error) {
        console.error("🔥 [Vercel] 1회용 코드 발급 실패!", error);
        return res.status(500).json({ message: "코드 발급 중 오류 발생" });
    }
}