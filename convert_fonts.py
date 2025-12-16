#!/usr/bin/env python3
"""OTF 폰트를 WOFF2 형식으로 변환하는 스크립트"""
import os
from fontTools.ttLib import TTFont

def convert_otf_to_woff2(otf_path, woff2_path):
    """OTF 파일을 WOFF2 형식으로 변환"""
    try:
        font = TTFont(otf_path)
        font.flavor = 'woff2'
        font.save(woff2_path)
        print(f"✅ 변환 성공: {os.path.basename(otf_path)} -> {os.path.basename(woff2_path)}")
        return True
    except Exception as e:
        print(f"❌ 변환 실패: {os.path.basename(otf_path)} - {str(e)}")
        return False

def main():
    fonts_dir = "public/fonts"
    otf_files = [
        "GangwonEduSaeum.otf",
        "GangwonEduModuBold.otf",
        "GangwonEduModuLight.otf",
        "GangwonEduHyunok.otf"
    ]
    
    converted_count = 0
    for otf_file in otf_files:
        otf_path = os.path.join(fonts_dir, otf_file)
        woff2_file = otf_file.replace('.otf', '.woff2')
        woff2_path = os.path.join(fonts_dir, woff2_file)
        
        if os.path.exists(otf_path):
            if convert_otf_to_woff2(otf_path, woff2_path):
                converted_count += 1
        else:
            print(f"⚠️  파일을 찾을 수 없음: {otf_path}")
    
    print(f"\n📊 변환 완료: {converted_count}/{len(otf_files)} 개 파일")

if __name__ == "__main__":
    main()

