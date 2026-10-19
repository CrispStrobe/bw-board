/* Freestanding mem* the compiler may emit for RT-Thread code; links -nostdlib. */
#include <stddef.h>
void *memcpy(void *d, const void *s, size_t n){ unsigned char *a=d; const unsigned char *b=s; while(n--)*a++=*b++; return d; }
void *memset(void *d, int c, size_t n){ unsigned char *a=d; while(n--)*a++=(unsigned char)c; return d; }
void *memmove(void *d, const void *s, size_t n){ unsigned char *a=d; const unsigned char *b=s; if(a<b){while(n--)*a++=*b++;}else{a+=n;b+=n;while(n--)*--a=*--b;} return d; }
int memcmp(const void *a,const void *b,size_t n){ const unsigned char *x=a,*y=b; while(n--){ if(*x!=*y)return *x-*y; x++;y++; } return 0; }
size_t strlen(const char *s){ const char *p=s; while(*p)p++; return (size_t)(p-s); }
char *strncpy(char *d,const char *s,size_t n){ char *r=d; while(n&&(*d++=*s++))n--; while(n--)*d++=0; return r; }
int strncmp(const char *a,const char *b,size_t n){ while(n&&*a&&(*a==*b)){a++;b++;n--;} return n?(unsigned char)*a-(unsigned char)*b:0; }
