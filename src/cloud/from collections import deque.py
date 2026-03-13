def max_corridor_area(segments):
    i=0
    j=len(segments)-1
    maxf=0
    while i<j:
        num= (j-i)*min(segments[j],segments[i])
        if segments[i]<segments[j]:
            i+=1
        else:
            j-=1
        maxf = max(maxf,num)
    return maxf
    

print(max_corridor_area([1, 8, 6, 2, 5, 4, 8, 3, 7])) 
print(max_corridor_area([1, 1])) 