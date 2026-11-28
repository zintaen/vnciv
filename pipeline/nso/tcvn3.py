# usage: tcvn3.py IN.txt OUT.txt  - the 2010-2016 yearbooks set their Vietnamese text in TCVN3 (ABC) fonts, which pypdf
# reads as Latin-1 look-alikes ("§µ N½ng" = "Đà Nẵng"). Lines with TCVN3-only characters and no Unicode Vietnamese
# letters are decoded; the English lines and the Unicode (newer) lines are left as they are.
import re, sys

# TCVN 5712:1993 (VN3) byte -> letter; pypdf gives the byte's Latin-1 character (0xAD soft hyphen as U+2212, 0xB5 also
# as Greek mu)
_T = dict(zip(range(0xA1, 0xAF), 'ĂÂÊÔƠƯĐăâêôơưđ'))
_T.update({0xB5: 'à', 0xB6: 'ả', 0xB7: 'ã', 0xB8: 'á', 0xB9: 'ạ', 0xBB: 'ằ', 0xBC: 'ẳ', 0xBD: 'ẵ', 0xBE: 'ắ', 0xC6: 'ặ',
           0xC7: 'ầ', 0xC8: 'ẩ', 0xC9: 'ẫ', 0xCA: 'ấ', 0xCB: 'ậ', 0xCC: 'è', 0xCE: 'ẻ', 0xCF: 'ẽ', 0xD0: 'é', 0xD1: 'ẹ',
           0xD2: 'ề', 0xD3: 'ể', 0xD4: 'ễ', 0xD5: 'ế', 0xD6: 'ệ', 0xD7: 'ì', 0xD8: 'ỉ', 0xDC: 'ĩ', 0xDD: 'í', 0xDE: 'ị',
           0xDF: 'ò', 0xE1: 'ỏ', 0xE2: 'õ', 0xE3: 'ó', 0xE4: 'ọ', 0xE5: 'ồ', 0xE6: 'ổ', 0xE7: 'ỗ', 0xE8: 'ố', 0xE9: 'ộ',
           0xEA: 'ờ', 0xEB: 'ở', 0xEC: 'ỡ', 0xED: 'ớ', 0xEE: 'ợ', 0xEF: 'ù', 0xF1: 'ủ', 0xF2: 'ũ', 0xF3: 'ú', 0xF4: 'ụ',
           0xF5: 'ừ', 0xF6: 'ử', 0xF7: 'ữ', 0xF8: 'ứ', 0xF9: 'ự', 0xFA: 'ỳ', 0xFB: 'ỷ', 0xFC: 'ỹ', 0xFD: 'ý', 0xFE: 'ỵ'})
MAP = {chr(b): c for b, c in _T.items()}
MAP.update({'−': 'ư', 'μ': 'à'})
# characters Unicode Vietnamese never uses (Latin-1 letters outside the Vietnamese alphabet, the TCVN3 look-alikes)
ONLY = set(MAP) - set('àáâãèéêìíòóôõùúýÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝ')
UNI = re.compile('[Ạ-ỹĂăĐđƠơƯư]')


def dec(s): return ''.join(MAP.get(c, c) for c in s)


def line(s, tcvn_page=False):
    """A line with TCVN3-only characters is decoded; one whose accents could be either ("Thanh Hãa") follows its page."""
    if UNI.search(s): return s
    return dec(s) if any(c in ONLY for c in s) or (tcvn_page and any(c in MAP for c in s)) else s


def page(lines):
    n_t = sum(1 for l in lines if any(c in ONLY for c in l) and not UNI.search(l))
    n_u = sum(1 for l in lines if UNI.search(l))
    return [line(l, n_t > n_u) for l in lines]


if __name__ == '__main__':
    assert line('§µ N½ng 385,6') == 'Đà Nẵng 385,6' and line('Hµ Néi') == 'Hà Nội' and line('Lùc l−îng') == 'Lực lượng'
    assert line('Đà Nẵng 3,4') == 'Đà Nẵng 3,4' and line('Bình Dương') == 'Bình Dương'
    assert page(['Hµ Néi 1,0', 'Thanh Hãa 2,0']) == ['Hà Nội 1,0', 'Thanh Hóa 2,0']
    assert page(['Hµ Néi', 'Thành phố 1', 'Đà Nẵng 2', 'Thanh Hóa 3']) == ['Hà Nội', 'Thành phố 1', 'Đà Nẵng 2', 'Thanh Hóa 3']
    out = []; cur = []
    for l in open(sys.argv[1], encoding='utf-8').read().split('\n'):
        if l.startswith('=====PAGE '): out += page(cur) + [l]; cur = []
        else: cur.append(l)
    open(sys.argv[2], 'w', encoding='utf-8').write('\n'.join(out + page(cur)))
