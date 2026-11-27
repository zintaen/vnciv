import unicodedata,re
CANON=['Hà Nội','Vĩnh Phúc','Bắc Ninh','Quảng Ninh','Hải Dương','Hải Phòng','Hưng Yên','Thái Bình','Hà Nam','Nam Định','Ninh Bình','Hà Giang','Cao Bằng','Bắc Kạn','Tuyên Quang','Lào Cai','Yên Bái','Thái Nguyên','Lạng Sơn','Bắc Giang','Phú Thọ','Điện Biên','Lai Châu','Sơn La','Hòa Bình','Thanh Hóa','Nghệ An','Hà Tĩnh','Quảng Bình','Quảng Trị','Thừa Thiên Huế','Đà Nẵng','Quảng Nam','Quảng Ngãi','Bình Định','Phú Yên','Khánh Hòa','Ninh Thuận','Bình Thuận','Kon Tum','Gia Lai','Đắk Lắk','Đắk Nông','Lâm Đồng','Bình Phước','Tây Ninh','Bình Dương','Đồng Nai','Bà Rịa - Vũng Tàu','TP. Hồ Chí Minh','Long An','Tiền Giang','Bến Tre','Trà Vinh','Vĩnh Long','Đồng Tháp','An Giang','Kiên Giang','Cần Thơ','Hậu Giang','Sóc Trăng','Bạc Liêu','Cà Mau']
assert len(CANON)==63
def key(s):
    s=unicodedata.normalize('NFC',s).replace('Ð','Đ').replace('đ','đ')
    for a,b in [('oà','òa'),('oá','óa'),('oả','ỏa'),('oã','õa'),('oạ','ọa'),('uỳ','ùy'),('uý','úy'),('uỷ','ủy'),('uỹ','ũy'),('uỵ','ụy')]: s=s.replace(a,b)
    s=s.lower().replace('thành phố','').replace('tp.','').replace('tp ','').replace('tỉnh ','').replace('thừa thiên','')
    s=s.replace('–','-').replace('—','-')
    return re.sub(r'[\s\-]','',s)
_K={key(c):c for c in CANON}
_K.update({'brvt':'Bà Rịa - Vũng Tàu','hcm':'TP. Hồ Chí Minh','tthuế':'Thừa Thiên Huế','hồchíminh':'TP. Hồ Chí Minh'})
def std(s): return _K.get(key(s))
if __name__=='__main__':
    for v in ['Hoà Bình','Huế','TP.Hồ Chí Minh','Ðắk Lắk','Thanh Hoá','Bà Rịa – Vũng Tàu','Thừa Thiên - Huế']: assert std(v),v
    assert std('Đồng bằng sông Hồng') is None; print('ok')
