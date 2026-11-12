// 手势判断：现在是不是“只伸出食指”☝️？
//
// 判断方法（每根手指都一样）：
//   比较“手腕 → 指尖”和“手腕 → 中间关节”的距离
//   - 指尖比关节离手腕更远 → 手指是伸直的
//   - 指尖比关节离手腕更近 → 手指是弯起来的
//
// MediaPipe 的编号：
//   0 = 手腕
//   食指：6 = 中间关节，8 = 指尖
//   中指：10 = 中间关节，12 = 指尖
//   无名指：14 = 中间关节，16 = 指尖
//   小指：18 = 中间关节，20 = 指尖
//   （大拇指的动作比较特别，先不判断）

const WRIST = 0;

// width、height：画面大小。MediaPipe 的 x、y 是比例，
// 要乘回像素才能正确算距离（画面是长方形，不是正方形）
export function isPointingPose(hand, width, height) {
  const distanceFromWrist = (index) =>
    Math.hypot(
      (hand[index].x - hand[WRIST].x) * width,
      (hand[index].y - hand[WRIST].y) * height
    );

  const isExtended = (tip, joint) =>
    distanceFromWrist(tip) > distanceFromWrist(joint);

  const indexUp = isExtended(8, 6);
  const middleDown = !isExtended(12, 10);
  const ringDown = !isExtended(16, 14);
  const pinkyDown = !isExtended(20, 18);

  return indexUp && middleDown && ringDown && pinkyDown;
}
