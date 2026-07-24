#version 300 es

precision highp float;

#define PI (3.14159265359)

const float N_R = 1.0 - 0.02;
const float N_G = 1.0;
const float N_B = 1.0 + 0.02;

in vec2 v_uv;
uniform sampler2D u_blurredBg;
uniform sampler2D u_bg;
uniform vec2 u_resolution;
uniform float u_dpr;
uniform vec2 u_mouse;
uniform vec2 u_mouseSpring;
uniform float u_mergeRate;
uniform float u_shapeWidth;
uniform float u_shapeHeight;
uniform float u_shapeRadius;
uniform float u_shapeRoundness;
uniform vec4 u_tint;
uniform float u_refThickness;
uniform float u_refFactor;
uniform float u_refDispersion;
uniform float u_refFresnelRange;
uniform float u_refFresnelFactor;
uniform float u_refFresnelHardness;
uniform float u_glareRange;
uniform float u_glareConvergence;
uniform float u_glareOppositeFactor;
uniform float u_glareFactor;
uniform float u_glareHardness;
uniform float u_glareAngle;
uniform int u_blurEdge;
uniform int u_showShape1;
uniform vec3 u_emissiveColor;
uniform float u_emissiveIntensity;
uniform float u_emissivePulse;
uniform int u_hdrEnabled;
uniform float u_exposure;
uniform int u_toneMappingType;
uniform float u_bloom;
uniform float u_time;

uniform vec4 u_lights[3];       // x, y, intensity, radius per light
uniform vec4 u_lightColors[3];  // r, g, b, unused per light
uniform int u_lightCount;       // 0-3
uniform float u_specularPower;  // GGX roughness (0.01-1.0)
uniform float u_specularIntensity; // specular brightness (0-2)
uniform int u_causticsEnabled;  // 0 or 1
uniform float u_causticsScale;  // pattern scale (1-20)
uniform float u_causticsIntensity; // brightness (0-2)
uniform float u_bevelWidth;     // edge bevel width (0-20)
uniform float u_edgeGlowIntensity; // edge glow (0-2)
uniform vec3 u_edgeGlowColor;  // edge glow color
uniform float u_colorBleedIntensity; // how much glass tints nearby bg (0-1)

// Phase 3: Material Realism
uniform float u_roughness;           // surface roughness 0-1
uniform float u_reflectionIntensity; // environment reflection strength 0-1
uniform int u_glassOnGlass;          // 0=merge, 1=layered
uniform float u_dofIntensity;        // depth-of-field blur intensity 0-1
uniform float u_frostedEdge;         // edge roughness gradient 0-1
uniform int u_sellmeierEnabled;      // use Sellmeier dispersion
uniform vec3 u_sellmeierB;           // Sellmeier B coefficients
uniform vec3 u_sellmeierC;           // Sellmeier C coefficients
uniform int u_multiBounce;           // 0=single, 1=multi-bounce refraction

// Phase 4: Surface Detail
uniform int u_smudgeEnabled;
uniform float u_smudgeIntensity;
uniform int u_scratchEnabled;
uniform float u_scratchDensity;
uniform float u_scratchDepth;
uniform float u_scratchAngle;
uniform int u_bubbleEnabled;
uniform int u_bubbleCount;
uniform float u_bubbleSeed;
uniform float u_bubbleSize;
uniform int u_dustEnabled;
uniform float u_dustDensity;
uniform float u_dustBrightness;

// Phase 5: Motion & Polish
uniform int u_flowEnabled;
uniform float u_flowSpeed;
uniform float u_flowScale;
uniform float u_flowIntensity;
uniform int u_pulseEnabled;
uniform float u_pulseAmplitude;
uniform float u_pulseFrequency;

uniform sampler2D u_uiContent;
uniform int u_uiContentEnabled;
uniform float u_uiContentOpacity;

uniform int u_shapeCount;
uniform vec4 u_shapes[8]; // x, y, width, height per shape
uniform vec4 u_shapeParams[8]; // radius, roundness, shapeType, unused per shape

uniform sampler2D u_textSDF;
uniform int u_textEnabled;
uniform float u_textScale;

uniform int STEP;

out vec4 fragColor;

float sdCircle(vec2 p, float r) {
  return length(p) - r;
}

vec3 sdSuperellipse(vec2 p, float r, float n) {
  p = p / r;
  vec2 gs = sign(p);
  vec2 ps = abs(p);
  float gm = pow(ps.x, n) + pow(ps.y, n);
  float gd = pow(gm, 1.0 / n) - 1.0;
  vec2 g = gs * pow(ps, vec2(n - 1.0)) * pow(gm, 1.0 / n - 1.0);
  p = abs(p);
  if (p.y > p.x) p = p.yx;
  n = 2.0 / n;
  float s = 1.0;
  float d = 1e20;
  const int num = 24;
  vec2 oq = vec2(1.0, 0.0);
  for (int i = 1; i < num; i++) {
    float h = float(i) / float(num - 1);
    vec2 q = vec2(pow(cos(h * PI / 4.0), n), pow(sin(h * PI / 4.0), n));
    vec2 pa = p - oq;
    vec2 ba = q - oq;
    vec2 z = pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    float d2 = dot(z, z);
    if (d2 < d) {
      d = d2;
      s = pa.x * ba.y - pa.y * ba.x;
    }
    oq = q;
  }
  return vec3(sqrt(d) * sign(s) * r, g);
}

float superellipseCornerSDF(vec2 p, float r, float n) {
  p = abs(p);
  float v = pow(pow(p.x, n) + pow(p.y, n), 1.0 / n);
  return v - r;
}

float roundedRectSDF(vec2 p, vec2 center, float width, float height, float cornerRadius, float n) {
  // 移动到中心坐标系
  p -= center;

  float cr = cornerRadius * u_dpr;

  // 计算到矩形边缘的距离
  vec2 d = abs(p) - vec2(width * u_dpr, height * u_dpr) * 0.5;

  // 对于边缘区域和角落，我们需要不同的处理
  float dist;

  if (d.x > -cr && d.y > -cr) {
    // 角落区域
    vec2 cornerCenter = sign(p) * (vec2(width * u_dpr, height * u_dpr) * 0.5 - vec2(cr));
    vec2 cornerP = p - cornerCenter;
    dist = superellipseCornerSDF(cornerP, cr, n);
  } else {
    // 内部和边缘区域
    dist = min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
  }

  return dist;
}

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// SDF for an ellipse (axis-aligned)
float sdEllipse(vec2 p, vec2 r) {
  vec2 k = p / r;
  return (length(k) - 1.0) * min(r.x, r.y);
}

// SDF for equilateral triangle centered at origin
float sdTriangle(vec2 p, float r) {
  const float k = sqrt(3.0);
  p.x = abs(p.x) - r;
  p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}

// SDF for 5-pointed star (rf = inner radius factor, 0.5 = classic star)
float sdStar(vec2 p, float r, float rf) {
  const vec2 k1 = vec2(0.809016994375, -0.587785252292);
  const vec2 k2 = vec2(-k1.x, k1.y);
  p.x = abs(p.x);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x);
  p.y -= r;
  vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0, 1);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}

// SDF for regular hexagon
float sdHexagon(vec2 p, float r) {
  const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
  p = abs(p);
  p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
  p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
  return length(p) * sign(p.y);
}

// SDF for pill/capsule shape
float sdPill(vec2 p, float w, float h) {
  p.y -= clamp(p.y, -h * 0.5, h * 0.5);
  return length(p) - w * 0.5;
}

// SDF for cross/plus shape
float sdCross(vec2 p, vec2 b, float r) {
  p = abs(p);
  p = (p.y > p.x) ? p.yx : p.xy;
  vec2 q = p - b;
  float k = max(q.y, q.x);
  vec2 w;
  if (k > 0.0) {
    w = max(q, 0.0);
  } else {
    w = vec2(b.y - p.x, -k);
  }
  return sign(k) * length(w) - r;
}

// SDF for heart shape
float sdHeart(vec2 p, float r) {
  p = p / r;
  p.x = abs(p.x);
  if (p.y + p.x > 1.0) {
    return (sqrt(dot(p - vec2(0.25, 0.75), p - vec2(0.25, 0.75))) - sqrt(2.0) / 4.0) * r;
  }
  return (sqrt(min(dot(p - vec2(0.0, 1.0), p - vec2(0.0, 1.0)),
                    dot(p - 0.5 * max(p.x + p.y, 0.0), p - 0.5 * max(p.x + p.y, 0.0)))) *
          sign(p.x - p.y)) * r;
}

// 2D rotation helper
vec2 rotate2D(vec2 p, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

// Dispatch SDF by shape type: 0=rect, 1=circle, 2=triangle, 3=star, 4=hexagon, 5=pill, 6=cross, 7=heart
float shapeSDF(vec2 pn, float shapeW, float shapeH, float shapeR, float shapeN, int shapeType) {
  float rY = u_resolution.y;
  if (shapeType == 1) {
    // Circle/ellipse
    return sdEllipse(pn, vec2(shapeW * u_dpr * 0.5, shapeH * u_dpr * 0.5) / rY);
  } else if (shapeType == 2) {
    // Triangle
    float s = min(shapeW, shapeH) * u_dpr * 0.5 / rY;
    return sdTriangle(pn, s);
  } else if (shapeType == 3) {
    // Star
    float s = min(shapeW, shapeH) * u_dpr * 0.5 / rY;
    return sdStar(pn, s, 0.45);
  } else if (shapeType == 4) {
    // Hexagon
    float s = min(shapeW, shapeH) * u_dpr * 0.5 / rY;
    return sdHexagon(pn, s);
  } else if (shapeType == 5) {
    // Pill/capsule
    float w = shapeW * u_dpr / rY;
    float h = shapeH * u_dpr / rY;
    return sdPill(pn, w, h);
  } else if (shapeType == 6) {
    // Cross
    float w = shapeW * u_dpr * 0.5 / rY;
    float h = shapeH * u_dpr * 0.5 / rY;
    float armW = min(w, h) * 0.35;
    return sdCross(pn, vec2(w, armW), shapeR * u_dpr * 0.01 / rY);
  } else if (shapeType == 7) {
    // Heart
    float s = min(shapeW, shapeH) * u_dpr * 0.5 / rY;
    return sdHeart(vec2(pn.x, -pn.y), s);
  } else {
    // Rectangle (default)
    return roundedRectSDF(pn, vec2(0.0), shapeW / rY, shapeH / rY, shapeR / rY, shapeN);
  }
}

float mainSDF(vec2 p1, vec2 p2, vec2 p) {
  float d;
  if (u_shapeCount > 0) {
    // Editor mode: loop over shape array
    float result = 1.0;
    bool hasShape = false;
    for (int i = 0; i < 8; i++) {
      if (i >= u_shapeCount) break;
      vec2 shapeCenter = vec2(u_shapes[i].x, u_shapes[i].y);
      float shapeW = u_shapes[i].z;
      float shapeH = u_shapes[i].w;
      float shapeR = u_shapeParams[i].x;
      float shapeN = u_shapeParams[i].y;
      int shapeType = int(u_shapeParams[i].z);
      float shapeRotation = u_shapeParams[i].w;
      vec2 pn = (-shapeCenter) / u_resolution.y + p / u_resolution.y;
      // Apply rotation around shape center
      if (abs(shapeRotation) > 0.001) {
        pn = rotate2D(pn, shapeRotation);
      }
      // Phase 5: Breathing pulse animation
      if (u_pulseEnabled == 1) {
        float pulseScale = 1.0 + u_pulseAmplitude * sin(u_time * u_pulseFrequency + float(i) * 1.5);
        pn = pn / pulseScale;
      }
      float dd = shapeSDF(pn, shapeW, shapeH, shapeR, shapeN, shapeType);
      if (!hasShape) {
        result = dd;
        hasShape = true;
      } else {
        result = smin(result, dd, u_mergeRate);
      }
    }
    d = result;
  } else {
    // Legacy follow mode
    vec2 p1n = p1 + p / u_resolution.y;
    vec2 p2n = p2 + p / u_resolution.y;

    float d1 = u_showShape1 == 1 ? sdCircle(p1n, 100.0 * u_dpr / u_resolution.y) : 1.0;
    float d2 = roundedRectSDF(
      p2n,
      vec2(0.0),
      u_shapeWidth / u_resolution.y,
      u_shapeHeight / u_resolution.y,
      u_shapeRadius / u_resolution.y,
      u_shapeRoundness
    );

    d = smin(d1, d2, u_mergeRate);
  }

  if (u_textEnabled == 1) {
    vec2 uv = p / u_resolution.xy;
    uv.y = 1.0 - uv.y;
    float textSample = texture(u_textSDF, uv).r;
    float textDist = (textSample - 0.5) * u_textScale / u_resolution.y;
    d = smin(d, textDist, u_mergeRate);
  }

  return d;
}

vec2 getNormal(vec2 p1, vec2 p2, vec2 p) {
  // 使用场景尺度自适应的 eps
  vec2 h = vec2(max(abs(dFdx(p.x)), 0.0001), max(abs(dFdy(p.y)), 0.0001));

  vec2 grad =
    vec2(
      mainSDF(p1, p2, p + vec2(h.x, 0.0)) - mainSDF(p1, p2, p - vec2(h.x, 0.0)),
      mainSDF(p1, p2, p + vec2(0.0, h.y)) - mainSDF(p1, p2, p - vec2(0.0, h.y))
    ) /
    (2.0 * h);

  // return normalize(grad);
  return grad * 1.414213562 * 1000.0;
}

vec2 getNormal2(vec2 p1, vec2 p2, vec2 p) {
  float eps = 0.7071 * 0.0005; // ~1/sqrt(2) * epsilon
  vec2 e1 = vec2(1.0, 1.0);
  vec2 e2 = vec2(-1.0, 1.0);
  vec2 e3 = vec2(1.0, -1.0);
  vec2 e4 = vec2(-1.0, -1.0);

  return normalize(
    e1 * mainSDF(p1, p2, p + eps * e1) +
      e2 * mainSDF(p1, p2, p + eps * e2) +
      e3 * mainSDF(p1, p2, p + eps * e3) +
      e4 * mainSDF(p1, p2, p + eps * e4)
  );
}

vec2 getNormal3(vec2 p1, vec2 p2, vec2 p) {
  float eps = 0.0005;
  vec2 e = vec2(eps, 0.0);

  float dx = mainSDF(p1, p2, p + e.xy) - mainSDF(p1, p2, p - e.xy); // ∂f/∂x
  float dy = mainSDF(p1, p2, p + e.yx) - mainSDF(p1, p2, p - e.yx); // ∂f/∂y

  return normalize(vec2(dx, dy));
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// from https://github.com/Rachmanin0xFF/GLSL-Color-Functions/blob/main/color-functions.glsl
//                          0.3127/0.3290  1.0  (1.0-0.3127-0.3290)/0.329
const vec3 D65_WHITE = vec3(0.95045592705, 1.0, 1.08905775076);
//                          0.3457/0.3585  1.0  (1.0-0.3457-0.3585)/0.3585
const vec3 D50_WHITE = vec3(0.96429567643, 1.0, 0.82510460251);
vec3 WHITE = D65_WHITE;
const mat3 RGB_TO_XYZ_M = mat3(
  0.4124, 0.3576, 0.1805,
  0.2126, 0.7152, 0.0722,
  0.0193, 0.1192, 0.9505
);
const mat3 XYZ_TO_XYZ50_M = mat3(
   1.0479298208405488  ,  0.022946793341019088, -0.05019222954313557 ,
   0.029627815688159344,  0.990434484573249   , -0.01707382502938514 ,
  -0.009243058152591178,  0.015055144896577895,  0.7518742899580008
);
const mat3 XYZ_TO_RGB_M = mat3(
   3.2406255, -1.537208 , -0.4986286,
  -0.9689307,  1.8757561,  0.0415175,
   0.0557101, -0.2040211,  1.0569959
);
const mat3 XYZ50_TO_XYZ_M = mat3(
   0.9554734527042182  , -0.023098536874261423,  0.0632593086610217  ,
  -0.028369706963208136,  1.0099954580058226  ,  0.021041398966943008,
   0.012314001688319899, -0.020507696433477912,  1.3303659366080753
);
float UNCOMPAND_SRGB(float a) {
  return a > 0.04045
    ? pow((a + 0.055) / 1.055, 2.4)
    : a / 12.92;
}
float COMPAND_RGB(float a) {
  return a <= 0.0031308
    ? 12.92 * a
    : 1.055 * pow(a, 0.41666666666) - 0.055;
}
vec3 RGB_TO_XYZ(vec3 rgb) {
  return WHITE == D65_WHITE
    ? rgb * RGB_TO_XYZ_M
    : rgb * RGB_TO_XYZ_M * XYZ_TO_XYZ50_M;
}
vec3 SRGB_TO_RGB(vec3 srgb) {
  return vec3(UNCOMPAND_SRGB(srgb.x), UNCOMPAND_SRGB(srgb.y), UNCOMPAND_SRGB(srgb.z));
}
vec3 RGB_TO_SRGB(vec3 rgb) {
  return vec3(COMPAND_RGB(rgb.x), COMPAND_RGB(rgb.y), COMPAND_RGB(rgb.z));
}
vec3 SRGB_TO_XYZ(vec3 srgb) {
  return RGB_TO_XYZ(SRGB_TO_RGB(srgb));
}
float XYZ_TO_LAB_F(float x) {
  //          (24/116)^3                         1/(3*(6/29)^2)     4/29
  return x > 0.00885645167
    ? pow(x, 0.333333333)
    : 7.78703703704 * x + 0.13793103448;
}
vec3 XYZ_TO_LAB(vec3 xyz) {
  vec3 xyz_scaled = xyz / WHITE;
  xyz_scaled = vec3(
    XYZ_TO_LAB_F(xyz_scaled.x),
    XYZ_TO_LAB_F(xyz_scaled.y),
    XYZ_TO_LAB_F(xyz_scaled.z)
  );
  return vec3(
    116.0 * xyz_scaled.y - 16.0,
    500.0 * (xyz_scaled.x - xyz_scaled.y),
    200.0 * (xyz_scaled.y - xyz_scaled.z)
  );
}
vec3 SRGB_TO_LAB(vec3 srgb) {
  return XYZ_TO_LAB(SRGB_TO_XYZ(srgb));
}
vec3 LAB_TO_LCH(vec3 Lab) {
  return vec3(Lab.x, sqrt(dot(Lab.yz, Lab.yz)), atan(Lab.z, Lab.y) * 57.2957795131);
}
vec3 SRGB_TO_LCH(vec3 srgb) {
  return LAB_TO_LCH(SRGB_TO_LAB(srgb));
}
vec3 XYZ_TO_RGB(vec3 xyz) {
  return WHITE == D65_WHITE
    ? xyz * XYZ_TO_RGB_M
    : xyz * XYZ50_TO_XYZ_M * XYZ_TO_RGB_M;
}
vec3 XYZ_TO_SRGB(vec3 xyz) {
  return RGB_TO_SRGB(XYZ_TO_RGB(xyz));
}
float LAB_TO_XYZ_F(float x) {
  //                                     3*(6/29)^2         4/29
  return x > 0.206897
    ? x * x * x
    : 0.12841854934 * (x - 0.137931034);
}
vec3 LAB_TO_XYZ(vec3 Lab) {
  float w = (Lab.x + 16.0) / 116.0;
  return WHITE *
  vec3(LAB_TO_XYZ_F(w + Lab.y / 500.0), LAB_TO_XYZ_F(w), LAB_TO_XYZ_F(w - Lab.z / 200.0));
}
vec3 LAB_TO_SRGB(vec3 lab) {
  return XYZ_TO_SRGB(LAB_TO_XYZ(lab));
}
vec3 LCH_TO_LAB(vec3 LCh) {
  return vec3(LCh.x, LCh.y * cos(LCh.z * 0.01745329251), LCh.y * sin(LCh.z * 0.01745329251));
}
vec3 LCH_TO_SRGB(vec3 lch) {
  return LAB_TO_SRGB(LCH_TO_LAB(lch));
}

// ACES Filmic tone mapping
vec3 ACESFilm(vec3 x) {
  float a = 2.51;
  float b = 0.03;
  float c = 2.43;
  float d = 0.59;
  float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

// Reinhard tone mapping
vec3 Reinhard(vec3 x) {
  return x / (1.0 + x);
}

float vec2ToAngle(vec2 v) {
  float angle = atan(v.y, v.x);
  if (angle < 0.0) angle += 2.0 * PI;
  return angle;
}

vec3 vec2ToRgb(vec2 v) {
  float angle = atan(v.y, v.x);
  if (angle < 0.0) angle += 2.0 * PI;
  float hue = angle / (2.0 * PI);
  vec3 hsv = vec3(hue, 1.0, 1.0);
  return hsv2rgb(hsv);
}

vec4 getTextureDispersion(
  sampler2D tex1,
  sampler2D tex2,
  float mixRate,
  vec2 offset,
  float factor
) {
  vec4 pixel = vec4(1.0);

  float bgR = texture(tex1, v_uv + offset * (1.0 - (N_R - 1.0) * factor)).r;
  float bgG = texture(tex1, v_uv + offset * (1.0 - (N_G - 1.0) * factor)).g;
  float bgB = texture(tex1, v_uv + offset * (1.0 - (N_B - 1.0) * factor)).b;

  float blurR = texture(tex2, v_uv + offset * (1.0 - (N_R - 1.0) * factor)).r;
  float blurG = texture(tex2, v_uv + offset * (1.0 - (N_G - 1.0) * factor)).g;
  float blurB = texture(tex2, v_uv + offset * (1.0 - (N_B - 1.0) * factor)).b;

  pixel.r = mix(bgR, blurR, mixRate);
  pixel.g = mix(bgG, blurG, mixRate);
  pixel.b = mix(bgB, blurB, mixRate);

  return pixel;
}

// GGX/Trowbridge-Reitz normal distribution
float distributionGGX(vec3 N, vec3 H, float roughness) {
    float a = roughness * roughness;
    float a2 = a * a;
    float NdotH = max(dot(N, H), 0.0);
    float NdotH2 = NdotH * NdotH;
    float num = a2;
    float denom = (NdotH2 * (a2 - 1.0) + 1.0);
    denom = 3.14159265 * denom * denom;
    return num / max(denom, 0.0001);
}

// Schlick approximation for Fresnel
vec3 fresnelSchlick(float cosTheta, vec3 F0) {
    return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

// Simple voronoi for caustics
float voronoi(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float minDist = 1.0;
    for (int x = -1; x <= 1; x++) {
        for (int y = -1; y <= 1; y++) {
            vec2 neighbor = vec2(float(x), float(y));
            vec2 point = vec2(
                fract(sin(dot(i + neighbor, vec2(127.1, 311.7))) * 43758.5453),
                fract(sin(dot(i + neighbor, vec2(269.5, 183.3))) * 43758.5453)
            );
            point = 0.5 + 0.5 * sin(u_time * 0.5 + 6.2831 * point);
            vec2 diff = neighbor + point - f;
            float dist = length(diff);
            minDist = min(minDist, dist);
        }
    }
    return minDist;
}

// Compute specular for a single light
vec3 computeSpecular(vec3 normal, vec2 fragPos, vec2 lightPos, float lightIntensity, vec3 lightColor, float roughness) {
    vec3 N = normalize(normal);
    vec3 V = vec3(0.0, 0.0, 1.0); // view from front
    vec2 lightDir2D = normalize(lightPos - fragPos);
    vec3 L = normalize(vec3(lightDir2D, 0.5));
    vec3 H = normalize(V + L);

    float NDF = distributionGGX(N, H, roughness);
    vec3 F = fresnelSchlick(max(dot(H, V), 0.0), vec3(0.04));

    float NdotL = max(dot(N, L), 0.0);
    vec3 spec = NDF * F * NdotL * lightColor * lightIntensity;
    return spec;
}

// Compute caustics pattern
float computeCaustics(vec2 uv, float scale, float time) {
    float v1 = voronoi(uv * scale);
    float v2 = voronoi(uv * scale * 1.5 + vec2(100.0));
    float caustic = pow(1.0 - v1, 3.0) + pow(1.0 - v2, 3.0) * 0.5;
    return caustic;
}

// === Phase 4: Surface Imperfection Noise Functions ===

vec3 mod289_imp(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289_imp2(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute_imp(vec3 x) { return mod289_imp(((x * 34.0) + 10.0) * x); }

float snoise_imp(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                        -0.577350269189626, 0.024390243902439);
    vec2 i = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289_imp2(i);
    vec3 p = permute_imp(permute_imp(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m * m;
    m = m * m;
    vec3 x_n = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x_n) - 0.5;
    vec3 ox = floor(x_n + 0.5);
    vec3 a0 = x_n - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
}

float fbm_imp(vec2 p, int octaves) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    for (int i = 0; i < 6; i++) {
        if (i >= octaves) break;
        value += amplitude * snoise_imp(p * frequency);
        frequency *= 2.0;
        amplitude *= 0.5;
    }
    return value;
}

float hash21_imp(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

vec2 hash22_imp(vec2 p) {
    return vec2(hash21_imp(p), hash21_imp(p + 127.1));
}

// === Phase 3: Material Realism Helper Functions ===

// Sellmeier equation: n²(λ) = 1 + B₁λ²/(λ²-C₁) + B₂λ²/(λ²-C₂) + B₃λ²/(λ²-C₃)
float sellmeierIOR(float wavelength, vec3 B, vec3 C) {
    float l2 = wavelength * wavelength;
    float n2 = 1.0
        + B.x * l2 / (l2 - C.x)
        + B.y * l2 / (l2 - C.y)
        + B.z * l2 / (l2 - C.z);
    return sqrt(max(n2, 1.0));
}

// Environment reflection sampling
vec3 sampleReflection(vec2 uv, vec2 normal, float intensity) {
    vec2 reflectUV = uv - normal * 0.15 * intensity;
    reflectUV = clamp(reflectUV, 0.0, 1.0);
    return texture(u_bg, reflectUV).rgb;
}

// Depth-based blur factor for depth-of-field
float getDepthBlur(float sdfDist, float dofIntensity) {
    // Thicker glass = more blur
    float thickness = clamp(-sdfDist * u_resolution.y * 0.1, 0.0, 1.0);
    return mix(1.0, thickness, dofIntensity);
}

// Frosted edge gradient - more rough near edges, clear in center
float getFrostedEdge(float sdfDist, float frostedEdge) {
    float edgeDist = clamp(-sdfDist * u_resolution.y * 0.5, 0.0, 1.0);
    return mix(1.0, 1.0 - edgeDist, frostedEdge);
}

// Sellmeier-based texture dispersion (replaces fixed N_R/N_G/N_B when enabled)
vec4 getTextureDispersionSellmeier(
  sampler2D tex1,
  sampler2D tex2,
  float mixRate,
  vec2 offset,
  float ior_r,
  float ior_g,
  float ior_b
) {
  vec4 pixel = vec4(1.0);

  float bgR = texture(tex1, v_uv + offset * (1.0 - (ior_r / ior_g - 1.0))).r;
  float bgG = texture(tex1, v_uv + offset).g;
  float bgB = texture(tex1, v_uv + offset * (1.0 - (ior_b / ior_g - 1.0))).b;

  float blurR = texture(tex2, v_uv + offset * (1.0 - (ior_r / ior_g - 1.0))).r;
  float blurG = texture(tex2, v_uv + offset).g;
  float blurB = texture(tex2, v_uv + offset * (1.0 - (ior_b / ior_g - 1.0))).b;

  pixel.r = mix(bgR, blurR, mixRate);
  pixel.g = mix(bgG, blurG, mixRate);
  pixel.b = mix(bgB, blurB, mixRate);

  return pixel;
}

void main() {
  vec2 u_resolution1x = u_resolution.xy / u_dpr;
  // center of shape 1
  vec2 p1 = (vec2(0, 0) - u_resolution.xy * 0.5) / u_resolution.y;
  // center of shape 2
  vec2 p2 = (vec2(0, 0) - u_mouseSpring) / u_resolution.y;
  // merged shape
  float merged = mainSDF(p1, p2, gl_FragCoord.xy);

  vec4 outColor;
  // step 0: sdfs
  if (STEP <= 0) {
    float px = 2.0 / u_resolution.y;
    vec3 col = merged > 0.0 ? vec3(1.0, 1.0, 1.0) * merged : vec3(1.0, 1.0, 1.0) * -merged * 2.0;
    col *= 3.0;
    col = mix(
      col,
      vec3(1.0),
      1.0 - smoothstep(0.5 / u_resolution1x.y - px, 0.5 / u_resolution1x.y + px, abs(merged))
    );
    outColor = vec4(col, 1.0);
  } else if (STEP <= 1) {
    float px = 2.0 / u_resolution.y;
    vec3 col = merged > 0.0 ? vec3(0.9, 0.6, 0.3) : vec3(0.65, 0.85, 1.0);
    // 阴影
    col *= 1.0 - exp(-0.03 * abs(merged) * u_resolution1x.y);
    // 等高线
    col *= 0.6 + 0.4 * smoothstep(-0.5, 0.5, cos(0.25 * abs(merged) * u_resolution1x.y * 2.0));
    // 外层白框
    col = mix(
      col,
      vec3(1.0),
      1.0 - smoothstep(1.5 / u_resolution1x.y - px, 1.5 / u_resolution1x.y + px, abs(merged))
    );
    outColor = vec4(col, 1.0);
    // step 1: normals
  } else if (STEP <= 2) {
    if (merged < 0.0) {
      vec2 normal = getNormal(p1, p2, gl_FragCoord.xy);
      vec3 normalColor = vec2ToRgb(normal);

      float l = length(normal);

      outColor = vec4(normalColor, l);
    } else {
      outColor = vec4(vec3(0.8), 0.0);
    }
    // step2: edge factors
  } else if (STEP <= 3) {
    if (merged < 0.0) {
      float nmerged = -1.0 * (merged * u_resolution1x.y);

      float x_R_ratio = 1.0 - nmerged / u_refThickness;
      float thetaI = asin(pow(x_R_ratio, 2.0));
      float thetaT = asin(1.0 / u_refFactor * sin(thetaI));
      float edgeFactor = -1.0 * tan(thetaT - thetaI);
      if (nmerged >= u_refThickness) {
        edgeFactor = 0.0;
      }

      if (nmerged < u_refThickness) {
        outColor = vec4(vec3(edgeFactor), 1.0);
      } else {
        outColor = vec4(vec3(0.0), 1.0);
      }
    } else {
      outColor = vec4(0.0);
    }
    // step3: edge factor with normal
  } else if (STEP <= 4) {
    if (merged < 0.0) {
      vec2 normal = getNormal(p1, p2, gl_FragCoord.xy);
      vec3 normalColor = vec2ToRgb(normal);
      float nmerged = -1.0 * (merged * u_resolution1x.y);

      float x_R_ratio = 1.0 - nmerged / u_refThickness;
      float thetaI = asin(pow(x_R_ratio, 2.0));
      float thetaT = asin(1.0 / u_refFactor * sin(thetaI));
      float edgeFactor = -1.0 * tan(thetaT - thetaI);
      if (nmerged >= u_refThickness) {
        edgeFactor = 0.0;
      }

      outColor = vec4(normalColor * edgeFactor * u_dpr * length(normal), 1.0);
    } else {
      outColor = vec4(0.0);
    }
    // add refaction
  } else if (STEP <= 5) {
    if (merged < 0.0) {
      outColor = texture(u_blurredBg, v_uv);
    } else {
      outColor = texture(u_bg, v_uv);
    }
  } else if (STEP <= 6) {
    if (merged < 0.0) {
      vec2 normal = getNormal(p1, p2, gl_FragCoord.xy);
      float nmerged = -1.0 * (merged * u_resolution1x.y);

      float x_R_ratio = 1.0 - nmerged / u_refThickness;
      float thetaI = asin(pow(x_R_ratio, 2.0));
      float thetaT = asin(1.0 / u_refFactor * sin(thetaI));
      float edgeFactor = -1.0 * tan(thetaT - thetaI);
      // Will have value > 0 inside of shape, force normalize here
      if (nmerged >= u_refThickness) {
        edgeFactor = 0.0;
      }

      if (edgeFactor <= 0.0) {
        outColor = texture(u_blurredBg, v_uv);
      } else {
        vec4 blurredPixel = texture(
          u_blurredBg,
          v_uv -
            normal *
              edgeFactor *
              0.05 *
              u_dpr *
              vec2(
                u_resolution.y / u_resolution1x.x, /* resolution independent */
                1.0
              )
        );
        outColor = blurredPixel;
      }
    } else {
      outColor = texture(u_bg, v_uv);
    }
    //
  } else if (STEP <= 7) {
    if (merged < 0.0) {
      vec2 normal = getNormal(p1, p2, gl_FragCoord.xy);
      float nmerged = -1.0 * (merged * u_resolution1x.y);

      float x_R_ratio = 1.0 - nmerged / u_refThickness;
      float thetaI = asin(pow(x_R_ratio, 2.0));
      float thetaT = asin(1.0 / u_refFactor * sin(thetaI));
      float edgeFactor = -1.0 * tan(thetaT - thetaI);
      // Will have value > 0 inside of shape, force normalize here
      if (nmerged >= u_refThickness) {
        edgeFactor = 0.0;
      }

      // other fresnel implements:
      // float r0 = pow((1.0 - u_refFactor) / (1.0 + u_refFactor), 2.0);
      // float fresnelFactor = r0 + (1.0 - r0) * pow(1.0 - cos(thetaI), 5.0);
      // if (fresnelFactor < 0.028) {
      //   fresnelFactor = 0.0;
      // }
      // fresnelFactor *= 10.0;

      // float fresnelFactor =
      //   0.5 *
      //   (pow(sin(thetaI - thetaT) / sin(thetaI + thetaT), 2.0) +
      //     pow(tan(thetaI - thetaT) / tan(thetaI + thetaT), 2.0));
      // fresnelFactor = clamp(fresnelFactor, 0.0, 1.0);

      float fresnelFactor = clamp(
        pow(
          1.0 +
            merged * u_resolution1x.y / 1500.0 * pow(500.0 / u_refFresnelRange, 2.0) +
            u_refFresnelHardness,
          5.0
        ),
        0.0,
        1.0
      );

      if (edgeFactor <= 0.0) {
        outColor = texture(u_blurredBg, v_uv);
      } else {
        vec4 blurredPixel = texture(
          u_blurredBg,
          v_uv -
            normal *
              edgeFactor *
              0.05 *
              u_dpr *
              vec2(
                u_resolution.y / u_resolution1x.x, /* resolution independent */
                1.0
              ),
          u_refDispersion
        );
        outColor = mix(blurredPixel, vec4(1.0), fresnelFactor * u_refFresnelFactor * 0.7);
        // outColor = vec4(vec3(fresnelFactor), 1.0);
      }
    } else {
      outColor = texture(u_bg, v_uv);
    }
  } else if (STEP <= 8) {
    if (merged < 0.0) {
      float nmerged = -1.0 * (merged * u_resolution1x.y);

      float x_R_ratio = 1.0 - nmerged / u_refThickness;
      float thetaI = asin(pow(x_R_ratio, 2.0));
      float thetaT = asin(1.0 / u_refFactor * sin(thetaI));
      float edgeFactor = -1.0 * tan(thetaT - thetaI);
      // Will have value > 0 inside of shape, force normalize here
      if (nmerged >= u_refThickness) {
        edgeFactor = 0.0;
      }

      float fresnelFactor = clamp(
        pow(
          1.0 +
            merged * u_resolution1x.y / 1500.0 * pow(500.0 / u_refFresnelRange, 2.0) +
            u_refFresnelHardness,
          5.0
        ),
        0.0,
        1.0
      );

      float glareGeoFactor = clamp(
        pow(
          1.0 +
            merged * u_resolution1x.y / 1500.0 * pow(500.0 / u_glareRange, 2.0) +
            u_glareHardness,
          5.0
        ),
        0.0,
        1.0
      );

      if (edgeFactor <= 0.0) {
        outColor = texture(u_blurredBg, v_uv);
        //
        // outColor = mix(
        //   outColor,
        //   vec4(u_tint.r, u_tint.g, u_tint.b, u_tint.a * 0.5),
        //   u_tint.a * 0.8
        // );
        // outColor.a = 1.0;
      } else {
        vec2 normal = getNormal(p1, p2, gl_FragCoord.xy);

        float glareAngle = (vec2ToAngle(normalize(normal)) - PI / 4.0 + u_glareAngle) * 2.0;
        int glareFarside = 0;
        if (
          glareAngle > PI * (2.0 - 0.5) && glareAngle < PI * (4.0 - 0.5) ||
          glareAngle < PI * (0.0 - 0.5)
        ) {
          glareFarside = 1;
        }

        float glareAngleFactor =
          (0.5 + sin(glareAngle) * 0.5) * 1.0 * (glareFarside == 1 ? 0.8 : 1.2) * u_glareFactor;
        glareAngleFactor = clamp(pow(glareAngleFactor, 0.3 + u_glareConvergence * 1.5), 0.0, 1.0);

        vec4 blurredPixel = texture(
          u_blurredBg,
          v_uv -
            normal *
              edgeFactor *
              0.05 *
              u_dpr *
              vec2(
                u_resolution.y / u_resolution1x.x, /* resolution independent */
                1.0
              ),
          u_refDispersion
        );
        //
        // outColor = mix(
        //   blurredPixel,
        //   vec4(u_tint.r, u_tint.g, u_tint.b, u_tint.a * 0.5),
        //   u_tint.a * 0.8
        // );
        // outColor.a = 1.0;
        // outColor = mix(outColor, vec4(1.0), fresnelFactor * u_refFresnelFactor * 0.7);
        outColor = blurredPixel;

        vec3 tintLCH = SRGB_TO_LCH(
          mix(vec3(1.0), vec3(u_tint.r, u_tint.g, u_tint.b), u_tint.a * 0.5)
        );
        tintLCH.x += 20.0 * fresnelFactor * u_refFresnelFactor;
        tintLCH.x = clamp(tintLCH.x, 0.0, 100.0);

        outColor = mix(
          outColor,
          // vec4(
          // LCH_TO_SRGB(tintLCH),
          // u_tint.a * 0.5
          // ),
          vec4(1.0),
          fresnelFactor * u_refFresnelFactor * 0.7
        );

        // ------
        outColor = mix(
          outColor,
          // vec4(
          //   LCH_TO_SRGB(tintLCH),
          //   u_tint.a * 0.5
          // ),
          vec4(1.0),
          glareAngleFactor * glareGeoFactor
        );
        // outColor = vec4(vec3(glareAngleFactor * glareGeoFactor), 1.0);
      }
    } else {
      outColor = texture(u_bg, v_uv);
    }
  } else if (STEP <= 9) {
    if (merged < 0.005) {
      float nmerged = -1.0 * (merged * u_resolution1x.y);

      // calculate refraction edge factor:
      float x_R_ratio = 1.0 - nmerged / u_refThickness;
      float thetaI = asin(pow(x_R_ratio, 2.0));
      float thetaT = asin(1.0 / u_refFactor * sin(thetaI));
      float edgeFactor = -1.0 * tan(thetaT - thetaI);
      // Will have value > 0 inside of shape, force normalize here
      if (nmerged >= u_refThickness) {
        edgeFactor = 0.0;
      }

      if (edgeFactor <= 0.0) {
        outColor = texture(u_blurredBg, v_uv);
        outColor = mix(outColor, vec4(u_tint.r, u_tint.g, u_tint.b, 1.0), u_tint.a * 0.8);
      } else {
        // height of glass edge:
        // h = r - sqrt(r*r - x*x) // (0<=x<=r)
        float edgeH = nmerged / u_refThickness;
        // (u_refThickness - sqrt(u_refThickness * u_refThickness - nmerged * nmerged)) /
        // u_refThickness;
        // u_refThickness - pow(u_refThickness * u_refThickness - nmerged * nmerged, 0.5);
        // u_refThickness - pow(u_refThickness * u_refThickness - nmerged * nmerged, 0.5);
        // calculate parameters
        vec2 normal = getNormal(p1, p2, gl_FragCoord.xy);

        // Phase 4: Surface Imperfections (normal perturbation)
        // Fingerprint smudges
        if (u_smudgeEnabled == 1 && nmerged > 0.0) {
            vec2 smudgeUV = gl_FragCoord.xy / u_resolution * 8.0;
            float smudge1 = fbm_imp(smudgeUV * 3.0, 4);
            float smudge2 = fbm_imp(smudgeUV * 5.0 + 100.0, 3);
            float ridges = sin(smudge1 * 20.0 + smudgeUV.x * 10.0) * 0.5 + 0.5;
            vec2 smudgePerturb = vec2(
                fbm_imp(smudgeUV + vec2(0.1, 0.0), 3) - fbm_imp(smudgeUV - vec2(0.1, 0.0), 3),
                fbm_imp(smudgeUV + vec2(0.0, 0.1), 3) - fbm_imp(smudgeUV - vec2(0.0, 0.1), 3)
            ) * ridges;
            normal += smudgePerturb * u_smudgeIntensity * 0.5;
        }

        // Surface scratches
        if (u_scratchEnabled == 1 && nmerged > 0.0) {
            vec2 scratchUV = gl_FragCoord.xy / u_resolution * u_scratchDensity;
            float angle = u_scratchAngle;
            vec2 rotUV = vec2(
                scratchUV.x * cos(angle) - scratchUV.y * sin(angle),
                scratchUV.x * sin(angle) + scratchUV.y * cos(angle)
            );
            float scratch = abs(sin(rotUV.x * 50.0 + snoise_imp(rotUV * 10.0) * 5.0));
            scratch = pow(scratch, 20.0);
            float scratchMask = step(0.7, hash21_imp(floor(rotUV * 3.0)));
            normal += vec2(scratch * scratchMask * u_scratchDepth * 0.3, 0.0);
        }

        vec2 refractionOffset = -normal *
            edgeFactor *
            0.05 *
            u_dpr *
            vec2(
              u_resolution.y / (u_resolution1x.x * u_dpr), /* resolution independent */
              1.0
            );

        // Phase 5: Liquid flow distortion
        if (u_flowEnabled == 1 && nmerged > 0.0) {
            vec2 flowUV = v_uv * u_flowScale;
            float flow1 = snoise_imp(flowUV + vec2(u_time * u_flowSpeed * 0.3, 0.0));
            float flow2 = snoise_imp(flowUV * 1.5 + vec2(0.0, u_time * u_flowSpeed * 0.2) + 50.0);
            refractionOffset += vec2(flow1, flow2) * u_flowIntensity * 0.01;
        }

        float blurMixRate = u_blurEdge > 0 ? 1.0 : edgeH;

        vec4 blurredPixel;
        if (u_sellmeierEnabled == 1) {
          // Sellmeier dispersion: wavelengths in micrometers R=0.65, G=0.55, B=0.45
          float ior_r = sellmeierIOR(0.65, u_sellmeierB, u_sellmeierC);
          float ior_g = sellmeierIOR(0.55, u_sellmeierB, u_sellmeierC);
          float ior_b = sellmeierIOR(0.45, u_sellmeierB, u_sellmeierC);
          blurredPixel = getTextureDispersionSellmeier(
            u_bg,
            u_blurredBg,
            blurMixRate,
            refractionOffset,
            ior_r,
            ior_g,
            ior_b
          );
        } else {
          // Original fixed dispersion
          blurredPixel = getTextureDispersion(
            u_bg,
            u_blurredBg,
            blurMixRate,
            refractionOffset,
            u_refDispersion
          );
        }

        // Multi-bounce refraction: apply a second refraction pass
        if (u_multiBounce == 1) {
          vec2 secondOffset = refractionOffset * 0.5;
          vec4 secondBounce = getTextureDispersion(
            u_bg,
            u_blurredBg,
            blurMixRate,
            refractionOffset + secondOffset,
            u_refDispersion * 0.7
          );
          blurredPixel.rgb = mix(blurredPixel.rgb, secondBounce.rgb, 0.3);
        }

        // Depth-of-field: mix in extra blur based on glass thickness
        if (u_dofIntensity > 0.0 && merged < 0.0) {
          float depthBlur = getDepthBlur(merged, u_dofIntensity);
          vec3 dofBlurred = texture(u_blurredBg, v_uv + refractionOffset).rgb;
          blurredPixel.rgb = mix(blurredPixel.rgb, dofBlurred, (1.0 - depthBlur) * 0.3);
        }

        // Frosted edge: increase roughness/blur near glass edges
        if (u_frostedEdge > 0.0) {
          float frosted = getFrostedEdge(merged, u_frostedEdge);
          vec3 frostedBlur = texture(u_blurredBg, v_uv + refractionOffset).rgb;
          blurredPixel.rgb = mix(blurredPixel.rgb, frostedBlur, (1.0 - frosted) * 0.5);
        }

        // basic tint
        outColor = mix(blurredPixel, vec4(u_tint.r, u_tint.g, u_tint.b, 1.0), u_tint.a * 0.8);

        // add fresnel
        float fresnelFactor = clamp(
          pow(
            1.0 +
              merged * u_resolution1x.y / 1500.0 * pow(500.0 / u_refFresnelRange, 2.0) +
              u_refFresnelHardness,
            5.0
          ),
          0.0,
          1.0
        );

        vec3 fresnelTintLCH = SRGB_TO_LCH(
          mix(vec3(1.0), vec3(u_tint.r, u_tint.g, u_tint.b), u_tint.a * 0.5)
        );
        fresnelTintLCH.x += 20.0 * fresnelFactor * u_refFresnelFactor;
        fresnelTintLCH.x = clamp(fresnelTintLCH.x, 0.0, 100.0);

        outColor = mix(
          outColor,
          vec4(LCH_TO_SRGB(fresnelTintLCH), 1.0),
          fresnelFactor * u_refFresnelFactor * 0.7 * length(normal)
        );

        // Environment reflections (Phase 3)
        if (u_reflectionIntensity > 0.0) {
          vec3 reflColor = sampleReflection(v_uv, normal, u_reflectionIntensity);
          // Blend reflection with fresnel - more reflection at glancing angles
          float reflFresnel = pow(1.0 - max(dot(normalize(vec3(normal, 1.0)), vec3(0.0, 0.0, 1.0)), 0.0), 3.0);
          outColor.rgb = mix(outColor.rgb, reflColor, reflFresnel * u_reflectionIntensity * 0.5);
        }

        // add glare
        float glareGeoFactor = clamp(
          pow(
            1.0 +
              merged * u_resolution1x.y / 1500.0 * pow(500.0 / u_glareRange, 2.0) +
              u_glareHardness,
            5.0
          ),
          0.0,
          1.0
        );

        float glareAngle = (vec2ToAngle(normalize(normal)) - PI / 4.0 + u_glareAngle) * 2.0;
        int glareFarside = 0;
        if (
          glareAngle > PI * (2.0 - 0.5) && glareAngle < PI * (4.0 - 0.5) ||
          glareAngle < PI * (0.0 - 0.5)
        ) {
          glareFarside = 1;
        }
        float glareAngleFactor =
          (0.5 + sin(glareAngle) * 0.5) *
          (glareFarside == 1
            ? 1.2 * u_glareOppositeFactor
            : 1.2) *
          u_glareFactor;
        glareAngleFactor = clamp(pow(glareAngleFactor, 0.1 + u_glareConvergence * 2.0), 0.0, 1.0);

        vec3 glareTintLCH = SRGB_TO_LCH(
          mix(blurredPixel.rgb, vec3(u_tint.r, u_tint.g, u_tint.b), u_tint.a * 0.5)
        );
        glareTintLCH.x += 150.0 * glareAngleFactor * glareGeoFactor;
        glareTintLCH.y += 30.0 * glareAngleFactor * glareGeoFactor;
        glareTintLCH.x = clamp(glareTintLCH.x, 0.0, 120.0);

        outColor = mix(
          outColor,
          vec4(LCH_TO_SRGB(glareTintLCH), 1.0),
          glareAngleFactor * glareGeoFactor * length(normal)
        );
      }

      // Phase 4: Air bubbles
      if (u_bubbleEnabled == 1 && nmerged > 0.0) {
          for (int bi = 0; bi < 20; bi++) {
              if (bi >= u_bubbleCount) break;
              vec2 bubbleCenter = hash22_imp(vec2(float(bi) + u_bubbleSeed, u_bubbleSeed + 0.5));
              vec2 bubblePos = (bubbleCenter - 0.5) * 0.5;
              float bubbleR = u_bubbleSize * (0.5 + hash21_imp(vec2(float(bi), 42.0)) * 0.5) / u_resolution.y;
              vec2 pBubble = gl_FragCoord.xy / u_resolution - 0.5 - bubblePos;
              float bubbleDist = length(pBubble) - bubbleR;
              if (bubbleDist < 0.0) {
                  vec2 bubbleN = normalize(pBubble);
                  vec2 invRefract = bubbleN * 0.02;
                  vec3 bubbleColor = texture(u_blurredBg, v_uv + invRefract).rgb;
                  float bubbleFresnel = pow(1.0 - abs(dot(bubbleN, vec2(0.0, 1.0))), 3.0);
                  outColor.rgb = mix(outColor.rgb, bubbleColor + vec3(bubbleFresnel * 0.3), smoothstep(0.0, -bubbleR * 0.5, bubbleDist));
              }
          }
      }

      // Phase 4: Dust particles
      if (u_dustEnabled == 1 && nmerged > 0.0) {
          vec2 dustUV = gl_FragCoord.xy / u_resolution * u_dustDensity * 100.0;
          vec2 dustCell = floor(dustUV);
          float dustVal = hash21_imp(dustCell);
          if (dustVal > 0.95) {
              vec2 dustPos = hash22_imp(dustCell);
              float dustDist = length(fract(dustUV) - dustPos);
              float dustDot = smoothstep(0.05, 0.0, dustDist);
              outColor.rgb += vec3(dustDot * u_dustBrightness * 0.5);
          }
      }

    } else {
      outColor = texture(u_bg, v_uv);
    }

    // UI content compositing
    if (u_uiContentEnabled == 1 && merged < 0.0) {
      float nmerged_ui = -1.0 * (merged * u_resolution1x.y);
      float x_R_ratio_ui = 1.0 - nmerged_ui / u_refThickness;
      float thetaI_ui = asin(pow(clamp(x_R_ratio_ui, 0.0, 1.0), 2.0));
      float thetaT_ui = asin(1.0 / u_refFactor * sin(thetaI_ui));
      float edgeFactor_ui = -1.0 * tan(thetaT_ui - thetaI_ui);
      if (nmerged_ui >= u_refThickness) {
        edgeFactor_ui = 0.0;
      }
      vec2 normal_ui = getNormal(p1, p2, gl_FragCoord.xy);
      vec2 refractedUV = v_uv;
      if (edgeFactor_ui > 0.0) {
        refractedUV = v_uv - normal_ui * edgeFactor_ui * 0.05 * u_dpr *
          vec2(u_resolution.y / (u_resolution1x.x * u_dpr), 1.0);
      }
      vec4 uiColor = texture(u_uiContent, refractedUV);
      outColor.rgb = mix(outColor.rgb, uiColor.rgb, uiColor.a * u_uiContentOpacity);
    }

    // Self-illumination (emissive glow)
    if (merged < 0.0 && u_emissiveIntensity > 0.0) {
      float nmerged_em = -1.0 * (merged * u_resolution1x.y);
      float emissiveDepth = clamp(nmerged_em / u_refThickness, 0.0, 1.0);
      float emissiveFactor = smoothstep(0.0, 0.5, emissiveDepth);
      float pulseMultiplier = 1.0 + u_emissivePulse * 0.3;
      vec3 emissive = u_emissiveColor * u_emissiveIntensity * emissiveFactor * pulseMultiplier;
      outColor.rgb += emissive;
    }

    // === Phase 2: Lighting Engine ===
    if (u_lightCount > 0 && merged < 0.0) {
      float nmerged_lt = -1.0 * (merged * u_resolution1x.y);
      vec2 normal_lt = getNormal(p1, p2, gl_FragCoord.xy);
      vec3 normal3D = vec3(normal_lt, sqrt(max(0.0, 1.0 - dot(normal_lt, normal_lt))));
      vec2 fragPos2D = gl_FragCoord.xy / u_resolution;

      vec3 totalSpecular = vec3(0.0);
      for (int i = 0; i < 3; i++) {
        if (i >= u_lightCount) break;
        vec2 lightPos = u_lights[i].xy / u_resolution;
        float lightIntensity = u_lights[i].z;
        float lightRadius = u_lights[i].w;
        vec3 lightColor = u_lightColors[i].rgb;

        float dist = length(fragPos2D - lightPos);
        float attenuation = 1.0 / (1.0 + dist * dist * 10.0 / max(lightRadius * lightRadius, 0.01));

        // Specular
        totalSpecular += computeSpecular(normal3D, fragPos2D, lightPos, lightIntensity, lightColor, u_specularPower) * attenuation * u_specularIntensity;

        // Caustics (only inside glass)
        if (u_causticsEnabled == 1 && nmerged_lt > 0.0) {
          float caustic = computeCaustics(fragPos2D + normal_lt * 0.1, u_causticsScale, u_time);
          outColor.rgb += caustic * u_causticsIntensity * lightColor * attenuation * 0.3;
        }
      }
      outColor.rgb += totalSpecular;

      // Bevel edge highlight
      if (u_bevelWidth > 0.0) {
        float bevelZone = smoothstep(0.0, u_bevelWidth / u_resolution.y, abs(merged));
        float bevelHighlight = (1.0 - bevelZone) * 0.5;
        for (int i = 0; i < 3; i++) {
          if (i >= u_lightCount) break;
          vec2 lightPos = u_lights[i].xy / u_resolution;
          vec2 lightDir = normalize(lightPos - fragPos2D);
          float bevelCatch = max(dot(normal_lt, lightDir), 0.0);
          outColor.rgb += u_lightColors[i].rgb * bevelHighlight * bevelCatch * u_lights[i].z;
        }
      }

      // Edge glow (total internal reflection simulation)
      if (u_edgeGlowIntensity > 0.0) {
        float edgeZone = smoothstep(2.0 / u_resolution.y, 0.0, abs(merged));
        outColor.rgb += u_edgeGlowColor * edgeZone * u_edgeGlowIntensity;
      }
    }

    // smooth
    outColor = mix(outColor, texture(u_bg, v_uv), smoothstep(-0.001, 0.001, merged));

  }

  // HDR tone mapping
  if (u_hdrEnabled == 1) {
    outColor.rgb *= u_exposure;

    // Bloom: extract bright areas and add soft glow
    if (u_bloom > 0.0) {
      vec3 bright = max(outColor.rgb - vec3(1.0), vec3(0.0));
      outColor.rgb += bright * u_bloom;
    }

    if (u_toneMappingType == 1) {
      outColor.rgb = Reinhard(outColor.rgb);
    } else if (u_toneMappingType == 2) {
      outColor.rgb = ACESFilm(outColor.rgb);
    }
    outColor.rgb = pow(outColor.rgb, vec3(1.0 / 2.2));
  }

  fragColor = outColor;
}
